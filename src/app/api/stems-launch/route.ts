import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const bat = path.join(process.cwd(), "start-stems.bat");
  if (!existsSync(bat)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "start-stems.bat introuvable — service local indisponible (déploiement distant ? lance-le à la main).",
      },
      { status: 404 },
    );
  }
  if (process.platform !== "win32") {
    return NextResponse.json(
      { ok: false, error: "start-stems.bat ne s'exécute que sous Windows." },
      { status: 400 },
    );
  }
  try {
    const child = spawn("cmd.exe", ["/c", "start", "", bat], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
