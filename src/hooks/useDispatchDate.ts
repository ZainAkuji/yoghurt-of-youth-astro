import { useEffect, useState } from "react";
import { nextDispatchISO } from "../config/dispatch";

// Refresh open tabs at the cutoff and when the customer returns to the page.
export function useDispatchDate(initialDate?: string) {
  const [date, setDate] = useState(() => initialDate || nextDispatchISO());
  useEffect(() => {
    const update = () => setDate(nextDispatchISO());
    update();
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return date;
}
