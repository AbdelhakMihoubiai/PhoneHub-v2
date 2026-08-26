"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RefreshButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function refresh() {
    setLoading(true);
    try {
      await fetch(`/api/phones/${id}/refresh`, { method: "POST" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
      {loading ? (
        <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        "⟳"
      )}
      {loading ? "Refreshing…" : "Refresh data"}
    </button>
  );
}
