"use client";
import Markdown from "react-markdown";

export default function MarkdownView({ source }: { source: string }) {
  if (!source || !source.trim()) {
    return (
      <p className="muted">
        No report yet. Approve some correlations and refresh this page.
      </p>
    );
  }
  return (
    <div className="report-content">
      <Markdown>{source}</Markdown>
    </div>
  );
}
