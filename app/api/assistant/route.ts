import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { resolveAssistantModel } from "@/lib/assistant/models";
import { buildAssistantSystemPrompt } from "@/lib/assistant/context";
import { flatNavItems } from "@/lib/navigation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type InMsg = { role: "user" | "assistant"; content: string };

/** GET /api/assistant — config pour la bulle : activé ? liste des modèles + défaut. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response(JSON.stringify({ enabled: false }), { status: 200, headers: { "Content-Type": "application/json" } });
  const { ASSISTANT_MODELS, resolveAssistantModel: resolve } = await import("@/lib/assistant/models");
  return new Response(
    JSON.stringify({ enabled: !!process.env.ANTHROPIC_API_KEY, models: ASSISTANT_MODELS, defaultModel: resolve(undefined) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const NAVIGATE_TOOL: Anthropic.Tool = {
  name: "navigate",
  description:
    "Ouvre un écran du logiciel pour l'utilisateur. À utiliser quand la réponse consiste à l'emmener sur un écran précis. Le chemin DOIT être un chemin exact de la carte de l'application.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Chemin exact de l'écran, ex. /encours ou /rh/conges" },
      label: { type: "string", description: "Libellé court de l'écran, ex. « Encours »" },
    },
    required: ["path"],
  },
};

/** POST /api/assistant — chat d'aide en streaming (SSE). Body: { messages, model? }.
 *  Clé API lue côté serveur uniquement. L'outil navigate est renvoyé au client. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response(JSON.stringify({ error: "Non autorisé" }), { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Assistant non configuré (clé API manquante)." }), { status: 503 });
  }

  let body: { messages?: InMsg[]; model?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "JSON invalide" }), { status: 400 }); }

  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12); // garde l'historique court (coût + latence)
  if (history.length === 0) return new Response(JSON.stringify({ error: "Message vide" }), { status: 400 });

  const model = resolveAssistantModel(body.model);
  const validPaths = new Set(flatNavItems().map((i) => i.href).concat(["/parametres", "/accueil"]));
  const client = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  const system = [{ type: "text" as const, text: buildAssistantSystemPrompt(), cache_control: { type: "ephemeral" as const } }];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        // Boucle d'outils courte : le modèle peut répondre en texte et/ou proposer une navigation.
        for (let step = 0; step < 3; step++) {
          const s = client.messages.stream({ model, max_tokens: 1024, system, tools: [NAVIGATE_TOOL], messages });
          s.on("text", (t) => send({ type: "text", text: t }));
          const final = await s.finalMessage();

          if (final.stop_reason === "tool_use") {
            messages.push({ role: "assistant", content: final.content });
            const results: Anthropic.ToolResultBlockParam[] = [];
            for (const block of final.content) {
              if (block.type === "tool_use" && block.name === "navigate") {
                const input = block.input as { path?: string; label?: string };
                const path = String(input?.path ?? "");
                const ok = validPaths.has(path);
                if (ok) send({ type: "navigate", path, label: input?.label ?? path });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: ok ? "Proposé à l'utilisateur (un bouton d'ouverture s'affiche)." : "Chemin inconnu — ne pas proposer ce lien.",
                  is_error: !ok,
                });
              }
            }
            messages.push({ role: "user", content: results });
            continue; // laisse le modèle conclure en une phrase
          }
          break; // end_turn / max_tokens / autre → terminé
        }
        send({ type: "done" });
      } catch (e) {
        const msg = e instanceof Anthropic.APIError ? `Assistant indisponible (${e.status}).` : "Assistant indisponible, réessayez.";
        send({ type: "error", error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
