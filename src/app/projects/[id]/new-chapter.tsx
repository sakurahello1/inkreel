"use client";

import { useState } from "react";
import { useAct } from "@/components/use-act";
import { createChapter } from "@/server/actions";
import { Button } from "@/components/ui";

export function NewChapterButton({ projectId, nextIndex }: { projectId: string; nextIndex: number }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const { act: start, pending } = useAct();
  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        新建章节
      </Button>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(() => createChapter(projectId, title || `第 ${nextIndex} 章`));
      }}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={`第 ${nextIndex} 章标题`}
        className="h-8 w-44 rounded-sm border border-line bg-panel px-2.5 text-[13px] outline-none focus:border-line-strong"
      />
      <Button variant="primary" type="submit" disabled={pending}>
        {pending ? "创建中…" : "创建"}
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        取消
      </Button>
    </form>
  );
}
