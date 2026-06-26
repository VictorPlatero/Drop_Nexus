import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Bot, MessageCircle, Send, Sparkles, X } from "lucide-react";
import type { DashboardSection } from "./Sidebar";
import type { DbConfiguration } from "../services/api";
import { databaseNexusAssistantPlugin, type AssistantSuggestion } from "../plugins/databaseNexusAssistantPlugin";

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  suggestions?: AssistantSuggestion[];
}

interface Props {
  section: DashboardSection;
  configurations: DbConfiguration[];
  onSection(section: DashboardSection): void;
}

export default function NexusChatbox({ section, configurations, onSection }: Props) {
  const context = useMemo(() => ({ section, configurations }), [section, configurations]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => [createWelcomeMessage(context)]);
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages((current) => current.length === 1 && current[0].id === "welcome" ? [createWelcomeMessage(context)] : current);
  }, [context]);

  useEffect(() => {
    if (open) scrollRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open]);

  const activeSuggestions = [...messages].reverse().find((message) => message.role === "assistant" && message.suggestions?.length)?.suggestions
    ?? databaseNexusAssistantPlugin.getSuggestions(context);

  const sendMessage = async (text: string, targetSection?: DashboardSection) => {
    const clean = text.trim();
    if (!clean || thinking) return;
    const nextContext = { ...context, section: targetSection ?? context.section };
    if (targetSection && targetSection !== section) onSection(targetSection);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: clean }
    ]);
    setDraft("");
    setOpen(true);
    setThinking(true);
    const reply = await databaseNexusAssistantPlugin.askExternal(clean, nextContext)
      ?? databaseNexusAssistantPlugin.ask(clean, nextContext);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "assistant", text: reply.text, suggestions: reply.suggestions }
    ]);
    setThinking(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage(draft);
  };

  const runSuggestion = (suggestion: AssistantSuggestion) => {
    void sendMessage(suggestion.prompt, suggestion.section);
  };

  return <div className="fixed bottom-5 right-5 z-40 md:bottom-6 md:right-6">
    {open && <section className="mb-3 flex h-[min(620px,calc(100vh-110px))] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-card border border-line bg-[#101010] shadow-2xl shadow-black/50 sm:w-[400px]">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-button bg-blue-600 text-white"><Bot size={18} /></div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-white">{databaseNexusAssistantPlugin.name}</h2>
            <p className="truncate text-xs text-zinc-500">Skill local .md + plugin del proyecto</p>
          </div>
        </div>
        <button type="button" className="rounded-button p-2 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" aria-label="Cerrar chat" title="Cerrar chat" onClick={() => setOpen(false)}>
          <X size={17} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-3">
          {messages.map((message) => <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[86%] whitespace-pre-line rounded-button px-3 py-2 text-sm leading-6 ${message.role === "user" ? "bg-blue-600 text-white" : "border border-line bg-[#0D0D0D] text-zinc-300"}`}>
              {message.text}
            </div>
          </div>)}
          {thinking && <div className="flex justify-start">
            <div className="rounded-button border border-line bg-[#0D0D0D] px-3 py-2 text-sm text-zinc-500">Consultando asistente...</div>
          </div>}
          <div ref={scrollRef} />
        </div>
      </div>

      <div className="border-t border-line px-3 py-3">
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {activeSuggestions.map((suggestion) => <button key={suggestion.id} type="button" title={suggestion.prompt} onClick={() => runSuggestion(suggestion)}
            className="inline-flex max-w-[210px] shrink-0 items-center gap-2 rounded-button border border-line bg-[#0D0D0D] px-3 py-2 text-left text-xs text-zinc-300 hover:border-blue-700 hover:text-blue-300">
            <Sparkles size={13} className="shrink-0 text-amber-300" />
            <span className="truncate">{suggestion.label}</span>
            {suggestion.section && <ArrowRight size={13} className="shrink-0 text-zinc-600" />}
          </button>)}
        </div>
        <form onSubmit={submit} className="flex items-end gap-2">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={1} placeholder="Pregunta sobre tu flujo..." disabled={thinking} className="max-h-24 min-h-11 resize-none" />
          <button type="submit" disabled={!draft.trim() || thinking} className="grid h-11 w-11 shrink-0 place-items-center rounded-button bg-blue-600 text-white hover:bg-blue-500" aria-label="Enviar" title="Enviar">
            <Send size={17} />
          </button>
        </form>
      </div>
    </section>}

    <button type="button" aria-label="Abrir Nexus Assistant" title="Abrir Nexus Assistant" onClick={() => setOpen((current) => !current)}
      className="grid h-14 w-14 place-items-center rounded-full border border-blue-500/50 bg-blue-600 text-white shadow-xl shadow-blue-950/40 hover:bg-blue-500">
      <MessageCircle size={23} />
    </button>
  </div>;
}

function createWelcomeMessage(context: { section: DashboardSection; configurations: DbConfiguration[] }): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    text: databaseNexusAssistantPlugin.getWelcomeMessage(context),
    suggestions: databaseNexusAssistantPlugin.getSuggestions(context)
  };
}
