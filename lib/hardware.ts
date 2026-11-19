import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HardwareProfile } from "@/lib/ollama-models";

const execFileAsync = promisify(execFile);

/** Detecta RAM y VRAM NVIDIA en el PC local (Windows/Linux). */
export async function detectHardware(): Promise<HardwareProfile> {
  const [ramGb, gpu] = await Promise.all([detectRamGb(), detectNvidia()]);
  return {
    ramGb,
    vramGb: gpu.vramGb,
    gpuName: gpu.name,
    source: ramGb != null || gpu.name ? "detected" : "unknown",
  };
}

async function detectRamGb(): Promise<number | null> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "powershell",
        ["-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"],
        { timeout: 4_000 },
      );
      const bytes = Number(stdout.trim());
      if (Number.isFinite(bytes) && bytes > 0) return Math.round(bytes / 1e9);
    } else {
      const { stdout } = await execFileAsync("sh", ["-c", "awk '/MemTotal/ {print $2}' /proc/meminfo"], {
        timeout: 2_000,
      });
      const kb = Number(stdout.trim());
      if (Number.isFinite(kb) && kb > 0) return Math.round(kb / 1e6);
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function detectNvidia(): Promise<{ name: string | null; vramGb: number | null }> {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
      { timeout: 3_000 },
    );
    const line = stdout.trim().split("\n")[0] || "";
    const [nameRaw, memRaw] = line.split(",").map((part) => part.trim());
    const mem = Number(memRaw);
    return {
      name: nameRaw || null,
      vramGb: Number.isFinite(mem) && mem > 0 ? Math.round(mem / 1024) : null,
    };
  } catch {
    return { name: null, vramGb: null };
  }
}
