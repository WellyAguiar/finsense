"use client";

import React from "react";

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={key++} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={key++} className="italic text-slate-200">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[12px] text-emerald-300"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

export function MarkdownText({ content }: { content: string }) {
  const blocks = content.split(/```/);

  return (
    <div className="space-y-2.5 leading-relaxed">
      {blocks.map((block, blockIdx) => {
        // Blocos ímpares são code blocks cercados por ```
        if (blockIdx % 2 === 1) {
          const lines = block.replace(/^\w+\n/, "").trim();
          if (!lines) return null;
          return (
            <pre
              key={blockIdx}
              className="overflow-x-auto rounded-xl border border-slate-700/80 bg-slate-950 p-3 font-mono text-xs text-slate-200"
            >
              <code>{lines}</code>
            </pre>
          );
        }

        const lines = block.split(/\r?\n/);
        const elements: React.ReactNode[] = [];
        let listItems: string[] = [];
        let listOrdered = false;

        const flushList = (keyPrefix: string) => {
          if (listItems.length === 0) return;
          const Tag = listOrdered ? "ol" : "ul";
          elements.push(
            <Tag
              key={`${keyPrefix}-list-${elements.length}`}
              className={
                listOrdered
                  ? "list-decimal space-y-1 pl-5 text-slate-200"
                  : "list-disc space-y-1 pl-5 text-slate-200"
              }
            >
              {listItems.map((item, i) => (
                <li key={i}>{renderInline(item)}</li>
              ))}
            </Tag>
          );
          listItems = [];
        };

        lines.forEach((rawLine, lineIdx) => {
          const line = rawLine.trim();
          if (!line) {
            flushList(`${blockIdx}-${lineIdx}`);
            return;
          }

          const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
          const orderedMatch = line.match(/^\d+\.\s+(.*)$/);

          if (bulletMatch) {
            if (listItems.length > 0 && listOrdered) flushList(`${blockIdx}-${lineIdx}`);
            listOrdered = false;
            listItems.push(bulletMatch[1]);
            return;
          }
          if (orderedMatch) {
            if (listItems.length > 0 && !listOrdered) flushList(`${blockIdx}-${lineIdx}`);
            listOrdered = true;
            listItems.push(orderedMatch[1]);
            return;
          }

          flushList(`${blockIdx}-${lineIdx}`);

          if (line.startsWith("### ")) {
            elements.push(
              <h4 key={lineIdx} className="pt-1 text-sm font-semibold text-white">
                {renderInline(line.slice(4))}
              </h4>
            );
          } else if (line.startsWith("## ")) {
            elements.push(
              <h3 key={lineIdx} className="pt-1 text-base font-semibold text-white">
                {renderInline(line.slice(3))}
              </h3>
            );
          } else if (line.startsWith("# ")) {
            elements.push(
              <h2 key={lineIdx} className="pt-1 text-base font-bold text-white">
                {renderInline(line.slice(2))}
              </h2>
            );
          } else {
            elements.push(<p key={lineIdx}>{renderInline(line)}</p>);
          }
        });

        flushList(`${blockIdx}-end`);

        return <React.Fragment key={blockIdx}>{elements}</React.Fragment>;
      })}
    </div>
  );
}
