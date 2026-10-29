// Copyright (c) 2026 Claude St-Jean. All rights reserved.
import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { q?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "corps invalide" }, { status: 400 });
  }
  const q = typeof body.q === "string" ? body.q.trim() : "";
  if (!q) {
    return NextResponse.json({ error: "q requis" }, { status: 400 });
  }

  try {
    const { stdout } = await execFileP(
      "yt-dlp",
      ["--get-id", `ytsearch1:${q}`],
      { timeout: 60_000, windowsHide: true, maxBuffer: 1024 * 1024 }
    );
    const id = stdout.trim().split(/\r?\n/)[0]?.trim() ?? "";
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
      return NextResponse.json({ error: "aucune vidéo trouvée", q }, { status: 404 });
    }
    return NextResponse.json({ videoId: id, q });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `yt-dlp: ${msg.slice(0, 200)}`, q },
      { status: 502 }
    );
  }
}