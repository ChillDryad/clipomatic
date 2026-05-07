import { useEffect, useRef, useState } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

let addToastFn: ((type: ToastType, message: string) => void) | null = null;
let toastCounter = 0;

export function showToast(type: ToastType, message: string) {
  addToastFn?.(type, message);
}

interface ToastItemProps {
  toast: ToastMessage;
  onRemove: (id: string) => void;
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  const styles: Record<ToastType, string> = {
    success:
      "border-[var(--momiji-neon-green)] bg-[var(--momiji-neon-green)]/10 text-[var(--momiji-neon-green)]",
    error:
      "border-[var(--momiji-red)] bg-[var(--momiji-red)]/10 text-[var(--momiji-red)]",
    info:
      "border-[var(--ctp-blue)] bg-[var(--ctp-blue)]/10 text-[var(--ctp-blue)]",
    warning:
      "border-[var(--ctp-yellow)] bg-[var(--ctp-yellow)]/10 text-[var(--ctp-yellow)]",
  };

  const icons: Record<ToastType, string> = {
    success: "🌸",
    error: "✕",
    info: "ℹ",
    warning: "⚠",
  };

  return (
    <div
      className={`glass-card px-4 py-3 border-l-4 flex items-center gap-3 animate-slideInRight ${styles[toast.type]}`}
      role="alert"
    >
      <span className="text-base flex-shrink-0">{icons[toast.type]}</span>
      <p className="text-sm flex-1">{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        className="text-current opacity-50 hover:opacity-100 flex-shrink-0"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    addToastFn = (type: ToastType, message: string) => {
      const id = `toast-${++toastCounter}`;
      setToasts((prev) => [...prev, { id, type, message }]);
    };
    return () => {
      addToastFn = null;
    };
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onRemove={removeToast} />
        </div>
      ))}
    </div>
  );
}
