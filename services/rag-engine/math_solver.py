"""Exact math with SymPy (+ optional Ollama Qwen2.5-Math for hard phrasing)."""

from __future__ import annotations

import ast
import re
from typing import Any

import httpx
import sympy as sp
from sympy.parsing.latex import parse_latex
from sympy.parsing.sympy_parser import (
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

TRANSFORMATIONS = standard_transformations + (implicit_multiplication_application,)


def solve_math_text(text: str, ollama_url: str = "", math_model: str = "qwen2.5-math:1.5b") -> dict[str, Any]:
    cleaned = text.strip()
    if not cleaned:
        return {"ok": False, "error": "Falta la expresión o el problema."}

    # Remembered / direct paths first (no LLM).
    direct = try_direct_sympy(cleaned)
    if direct["ok"]:
        return direct

    # Optional: ask a local math model for a SymPy expression, then evaluate safely.
    if ollama_url:
        generated = ask_math_model(cleaned, ollama_url, math_model)
        if generated.get("ok"):
            evaluated = evaluate_sympy_code(generated["code"], cleaned)
            if evaluated["ok"]:
                evaluated["steps"] = [
                    "1. El modelo matemático local propuso código SymPy.",
                    *evaluated.get("steps", []),
                ]
                evaluated["backend"] = f"ollama:{math_model}+sympy"
                return evaluated

    return {
        "ok": False,
        "error": "No pude traducir el problema a SymPy. Prueba con LaTeX o una expresión más clara.",
        "latex": cleaned if "\\" in cleaned else None,
    }


def try_direct_sympy(text: str) -> dict[str, Any]:
    lower = text.lower().strip()
    latex = extract_latex(text)
    expr_source = latex or text

    percent = try_percentage(text)
    if percent["ok"]:
        return percent

    # Integral: ∫ or \int or "integra"
    if re.search(r"\\int|∫|integr", lower) or (latex and "\\int" in latex):
        return integrate_problem(expr_source)

    if re.search(r"\\frac\{d|deriv|d/dx|∂", lower) or "deriv" in lower:
        return differentiate_problem(expr_source)

    if "=" in text and re.search(r"[a-zA-Z]", text):
        return solve_equation(text)

    if re.search(r"simplif|expand|factor", lower):
        return simplify_problem(expr_source)

    # Bare arithmetic / expression — refuse bare `%` (SymPy treats it as Mod).
    if "%" in text and not latex:
        return {"ok": False, "error": "direct-parse-failed"}

    try:
        expr = parse_math(expr_source)
        value = sp.N(expr) if expr.free_symbols == set() else sp.simplify(expr)
        return {
            "ok": True,
            "latex": sp.latex(expr),
            "result": str(value),
            "result_latex": sp.latex(value),
            "code": f"expr = {expr}\nresult = simplify(expr) if expr.free_symbols else N(expr)",
            "steps": [
                f"1. Interpreté la expresión como `{expr}`.",
                f"2. SymPy calculó: `{value}`.",
            ],
            "backend": "sympy",
        }
    except Exception:
        return {"ok": False, "error": "direct-parse-failed"}


def try_percentage(text: str) -> dict[str, Any]:
    match = re.search(
        r"(?i)(?:cu[aá]nto\s+es\s+)?(\d+(?:[.,]\d+)?)\s*%\s*(?:de|of)\s*(\d+(?:[.,]\d+)?)",
        text,
    )
    if not match:
        return {"ok": False, "error": "not-percentage"}
    pct = float(match.group(1).replace(",", "."))
    base = float(match.group(2).replace(",", "."))
    value = pct / 100.0 * base
    pretty = int(value) if abs(value - round(value)) < 1e-9 else round(value, 10)
    return {
        "ok": True,
        "latex": rf"\frac{{{pct}}}{{100}}\cdot {base}",
        "result": str(pretty),
        "result_latex": str(pretty),
        "code": f"result = ({pct} / 100) * {base}",
        "steps": [
            f"1. Porcentaje: `{pct}%` de `{base}`.",
            f"2. Cálculo: `({pct}/100)*{base} = {pretty}`.",
        ],
        "backend": "sympy-percentage",
    }


def integrate_problem(source: str) -> dict[str, Any]:
    try:
        if "\\int" in source or "∫" in source:
            expr = parse_math(source.replace("∫", "\\int "))
            # If parse_latex already integrated? Usually parse_latex of \int x^2 dx works as Integral
            if isinstance(expr, sp.Integral):
                result = sp.simplify(expr.doit())
                return ok_result(expr, result, f"integrate from latex: {source}")
        # "integra x^2" / "integral de x**2"
        body = re.sub(r"(?i)integr(?:a|al|ar)?(?:\s+de)?", "", source).strip()
        body = body.replace("dx", "").strip()
        expr = parse_math(body or source)
        result = sp.integrate(expr, sp.Symbol("x"))
        return ok_result(sp.Integral(expr, sp.Symbol("x")), result, f"integrate({expr}, x)")
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "error": f"No pude integrar: {error}"}


def differentiate_problem(source: str) -> dict[str, Any]:
    try:
        body = re.sub(r"(?i)deriv(?:a|ar|ada)?(?:\s+de)?", "", source)
        body = re.sub(r"(?i)d/dx|∂/∂x", "", body).strip()
        expr = parse_math(body or source)
        result = sp.diff(expr, sp.Symbol("x"))
        return ok_result(sp.Derivative(expr, sp.Symbol("x")), result, f"diff({expr}, x)")
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "error": f"No pude derivar: {error}"}


def solve_equation(source: str) -> dict[str, Any]:
    try:
        left, right = source.split("=", 1)
        left_expr = parse_math(left)
        right_expr = parse_math(right)
        equation = sp.Eq(left_expr, right_expr)
        symbols = sorted(equation.free_symbols, key=lambda s: s.name)
        if not symbols:
            return {"ok": False, "error": "La ecuación no tiene incógnitas."}
        solutions = sp.solve(equation, symbols[0])
        result = solutions[0] if len(solutions) == 1 else solutions
        code = f"eq = Eq({left_expr}, {right_expr})\nresult = solve(eq, {symbols[0]})"
        return {
            "ok": True,
            "latex": sp.latex(equation),
            "result": str(result),
            "result_latex": sp.latex(result),
            "code": code,
            "steps": [
                f"1. Ecuación: `{equation}`.",
                f"2. Despejé `{symbols[0]}` con SymPy.",
                f"3. Solución: `{result}`.",
            ],
            "backend": "sympy",
        }
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "error": f"No pude resolver la ecuación: {error}"}


def simplify_problem(source: str) -> dict[str, Any]:
    try:
        body = re.sub(r"(?i)simplif(?:ica|icar)?|expand(?:e|ir)?|factor(?:iza|izar)?", "", source).strip()
        expr = parse_math(body or source)
        if re.search(r"expand", source, re.I):
            result = sp.expand(expr)
            op = "expand"
        elif re.search(r"factor", source, re.I):
            result = sp.factor(expr)
            op = "factor"
        else:
            result = sp.simplify(expr)
            op = "simplify"
        return ok_result(expr, result, f"{op}({expr})")
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "error": f"No pude simplificar: {error}"}


def ok_result(expr: Any, result: Any, code: str) -> dict[str, Any]:
    return {
        "ok": True,
        "latex": sp.latex(expr),
        "result": str(result),
        "result_latex": sp.latex(result),
        "code": code,
        "steps": [
            f"1. Expresión: `{expr}`.",
            f"2. Ejecuté SymPy: `{code}`.",
            f"3. Resultado exacto: `{result}`.",
        ],
        "backend": "sympy",
    }


def parse_math(source: str) -> Any:
    source = source.strip()
    if not source:
        raise ValueError("empty")
    if "\\" in source or source.startswith("\\"):
        return parse_latex(source)
    # Normalize unicode operators.
    source = (
        source.replace("×", "*")
        .replace("÷", "/")
        .replace("−", "-")
        .replace("^", "**")
        .replace("√", "sqrt")
    )
    return parse_expr(source, transformations=TRANSFORMATIONS)


def extract_latex(text: str) -> str | None:
    match = re.search(r"\$\$(.+?)\$\$|\$(.+?)\$|\\\((.+?)\\\)|\\\[(.+?)\\\]", text, re.S)
    if not match:
        if "\\" in text:
            return text.strip()
        return None
    return next(group for group in match.groups() if group)


ALLOWED_NODES = (
    ast.Expression,
    ast.BinOp,
    ast.UnaryOp,
    ast.Constant,
    ast.Name,
    ast.Load,
    ast.Call,
    ast.Attribute,
    ast.Tuple,
    ast.List,
    ast.Dict,
    ast.Subscript,
    ast.Slice,
    ast.Compare,
    ast.BoolOp,
    ast.IfExp,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.Pow,
    ast.Mod,
    ast.FloorDiv,
    ast.USub,
    ast.UAdd,
    ast.Eq,
    ast.NotEq,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
    ast.And,
    ast.Or,
    ast.keyword,
)


def evaluate_sympy_code(code: str, original: str) -> dict[str, Any]:
    """Safely evaluate a tiny SymPy snippet (no imports, no attribute writes)."""
    code = code.strip()
    # Prefer a single expression assignment to `result`.
    match = re.search(r"result\s*=\s*(.+)$", code, re.M | re.S)
    expression = match.group(1).strip() if match else code
    expression = expression.splitlines()[-1].strip()
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as error:
        return {"ok": False, "error": f"Código SymPy inválido: {error}"}

    for node in ast.walk(tree):
        if not isinstance(node, ALLOWED_NODES):
            return {"ok": False, "error": f"Operación no permitida en sandbox: {type(node).__name__}"}
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id not in SAFE_FUNCS:
                return {"ok": False, "error": f"Función no permitida: {func.id}"}
            if isinstance(func, ast.Attribute):
                return {"ok": False, "error": "No se permiten métodos en el sandbox."}

    env = {name: getattr(sp, name) for name in SAFE_FUNCS}
    env.update(
        {
            "x": sp.Symbol("x"),
            "y": sp.Symbol("y"),
            "z": sp.Symbol("z"),
            "t": sp.Symbol("t"),
            "n": sp.Symbol("n", integer=True),
            "pi": sp.pi,
            "E": sp.E,
            "I": sp.I,
        }
    )
    try:
        result = eval(compile(tree, "<sympy>", "eval"), {"__builtins__": {}}, env)  # noqa: S307
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "error": f"Falló la ejecución SymPy: {error}"}

    return {
        "ok": True,
        "latex": original,
        "result": str(result),
        "result_latex": sp.latex(result),
        "code": f"result = {expression}",
        "steps": [
            f"1. Problema: {original}",
            f"2. Código SymPy seguro: `result = {expression}`",
            f"3. Resultado exacto: `{result}`",
        ],
        "backend": "sympy-sandbox",
    }


SAFE_FUNCS = {
    "Eq",
    "Integral",
    "Derivative",
    "Symbol",
    "symbols",
    "solve",
    "simplify",
    "expand",
    "factor",
    "diff",
    "integrate",
    "limit",
    "summation",
    "Matrix",
    "sqrt",
    "sin",
    "cos",
    "tan",
    "asin",
    "acos",
    "atan",
    "log",
    "ln",
    "exp",
    "Abs",
    "factorial",
    "binomial",
    "N",
    "Rational",
    "Integer",
    "Float",
    "pi",
    "E",
    "I",
}


def ask_math_model(problem: str, ollama_url: str, model: str) -> dict[str, Any]:
    prompt = (
        "Eres un traductor a SymPy. Devuelve SOLO una línea Python de la forma "
        "`result = ...` usando funciones de sympy (integrate, diff, solve, simplify, Eq, sqrt, sin...). "
        "Sin markdown, sin explicaciones.\n\n"
        f"Problema: {problem}"
    )
    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                f"{ollama_url.rstrip('/')}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
            )
            if response.status_code != 200:
                return {"ok": False, "error": "math-model-unavailable"}
            text = (response.json().get("response") or "").strip()
            line = next((row.strip() for row in text.splitlines() if "result" in row), text)
            line = line.strip("` ")
            if not line.startswith("result"):
                line = f"result = {line}"
            return {"ok": True, "code": line}
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "error": str(error)}
