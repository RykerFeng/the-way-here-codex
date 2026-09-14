import path from "node:path";
import type { SourceKind } from "../types.js";
import { extractHtmlContent } from "./html.js";

export interface NormalizedDocument {
  title: string;
  content: string;
  kind: SourceKind;
  originSuffix?: string;
}

const textExtensions = new Set([".md", ".markdown", ".txt"]);

export function isSupportedFileName(fileName: string): boolean {
  const extension = path.extname(fileName).toLocaleLowerCase();
  return textExtensions.has(extension) || extension === ".html" || extension === ".htm" || extension === ".json";
}

export function normalizeFileContent(fileName: string, bytes: Buffer, sourceUrl?: string): NormalizedDocument[] {
  const extension = path.extname(fileName).toLocaleLowerCase();
  const fallbackTitle = path.basename(fileName, extension) || "未命名资料";
  const decoded = bytes.toString("utf8").replaceAll("\0", "").replace(/\r\n?/g, "\n").trim();
  if (!decoded) return [];

  if (textExtensions.has(extension)) {
    const heading = extension === ".md" || extension === ".markdown"
      ? /^\s*#\s+(.+?)\s*#*\s*$/m.exec(decoded)?.[1]?.trim()
      : undefined;
    return [{ title: heading || fallbackTitle, content: decoded, kind: "file" }];
  }
  if (extension === ".html" || extension === ".htm") {
    const { title, content } = extractHtmlContent(decoded, sourceUrl);
    return content ? [{ title, content, kind: "file" }] : [];
  }
  if (extension === ".json") return normalizeJson(decoded, fallbackTitle);
  return [];
}

function normalizeJson(decoded: string, fallbackTitle: string): NormalizedDocument[] {
  let value: unknown;
  try {
    value = JSON.parse(decoded);
  } catch {
    return [{ title: fallbackTitle, content: decoded, kind: "file" }];
  }

  if (Array.isArray(value) && value.some(isChatConversation)) {
    return value.filter(isChatConversation).map((conversation, index) => {
      const title = asNonEmptyString(conversation.title) ?? `${fallbackTitle} ${index + 1}`;
      const messages = Object.values(conversation.mapping)
        .map((node) => normalizeChatNode(node))
        .filter((node): node is ChatLine => node !== null)
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
      return {
        title,
        kind: "chat" as const,
        originSuffix: `conversation-${index + 1}`,
        content: [`# ${title}`, ...messages.map((message) => `## ${message.role}\n${message.text}`)].join("\n\n"),
      };
    });
  }

  return [{ title: fallbackTitle, content: JSON.stringify(value, null, 2), kind: "file" }];
}

interface ChatConversation {
  title?: unknown;
  mapping: Record<string, unknown>;
}

interface ChatLine {
  id: string;
  role: string;
  text: string;
  createdAt: number;
}

function isChatConversation(value: unknown): value is ChatConversation {
  return typeof value === "object" && value !== null && "mapping" in value
    && typeof (value as { mapping?: unknown }).mapping === "object"
    && (value as { mapping?: unknown }).mapping !== null;
}

function normalizeChatNode(value: unknown): ChatLine | null {
  if (typeof value !== "object" || value === null) return null;
  const node = value as {
    id?: unknown;
    message?: { author?: { role?: unknown }; create_time?: unknown; content?: { parts?: unknown } } | null;
  };
  if (!node.message) return null;
  const role = asNonEmptyString(node.message.author?.role) ?? "unknown";
  const parts = node.message.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map(partToText).filter(Boolean).join("\n").trim();
  if (!text) return null;
  return {
    id: asNonEmptyString(node.id) ?? "",
    role,
    text,
    createdAt: typeof node.message.create_time === "number" ? node.message.create_time : 0,
  };
}

function partToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "text" in value && typeof (value as { text?: unknown }).text === "string") {
    return (value as { text: string }).text;
  }
  return "";
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
