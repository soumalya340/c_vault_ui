import { NextResponse } from "next/server";

/**
 * Drafts the vault "Additional information" text from the share name, via
 * NVIDIA's OpenAI-compatible NIM endpoint. Server-only — NVIDIA_API_KEY never
 * reaches the client. Purely a drafting aid: the result is editable in the
 * form before submit, nothing here writes on-chain or to Supabase.
 */

const MAX_METADATA_VALUE_LEN = 128;
const NVIDIA_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "NVIDIA_API_KEY is not configured on the server." },
        { status: 500 },
      );
    }

    const body = (await request.json()) as { shareName?: string };
    const shareName = body.shareName?.trim();
    if (!shareName) {
      return NextResponse.json({ error: "shareName is required." }, { status: 400 });
    }

    const prompt =
      `Write a short, factual one-sentence description of an on-chain ETF vault ` +
      `whose share token is named "${shareName}". Plain prose, no markdown, no quotes, ` +
      `no emoji, under ${MAX_METADATA_VALUE_LEN} characters. Do not invent specific ` +
      `numbers, percentages, or token holdings — describe the general strategy implied ` +
      `by the name only.`;

    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 200,
        chat_template_kwargs: { enable_thinking: false },
        stream: false,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `NVIDIA API request failed (${res.status}): ${detail.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    let text = data.choices?.[0]?.message?.content?.trim() ?? "";
    text = text.replace(/^["']|["']$/g, "");
    if (text.length > MAX_METADATA_VALUE_LEN) {
      text = text.slice(0, MAX_METADATA_VALUE_LEN).trim();
    }
    if (!text) {
      return NextResponse.json({ error: "Model returned an empty response." }, { status: 502 });
    }

    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
