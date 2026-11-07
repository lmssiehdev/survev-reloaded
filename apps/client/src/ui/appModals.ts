import type { FindGameResponse } from "@survev/shared/types/api.ts";
import { createStore } from "solid-js";
import { MenuModal } from "./menuModal.ts";

/** what the notification and ip ban modals show; the views are in components/AppModals.tsx */
export const [appModals, setAppModals] = createStore({
    /** "\n" starts a new line */
    notification: "",
    ipBanReason: "",
    ipBanExpiration: "",
});

export const notificationModal = new MenuModal();
export const refreshModal = new MenuModal();
export const ipBanModal = new MenuModal();

export function showNotification(text: string) {
    setAppModals((s) => {
        s.notification = text;
    });
    notificationModal.show();
}

/** the client is older than the server: offer a reload */
export function showRefresh() {
    refreshModal.show(true);
}

function banExpiration(expiresAt: Date | string | null) {
    if (!expiresAt) return "Duration: indefinite";
    const timeLeft = new Date(expiresAt).getTime() - Date.now();
    const daysLeft = Math.round(timeLeft / (1000 * 60 * 60 * 24));
    const hoursLeft = Math.round(timeLeft / (1000 * 60 * 60));
    if (daysLeft > 1) return `Expires in: ${daysLeft} days`;
    if (hoursLeft > 1) return `Expires in: ${hoursLeft} hours`;
    return "Expires in: less than an hour";
}

export function showIpBan(ban: FindGameResponse & { type: "banned" }) {
    setAppModals((s) => {
        s.ipBanReason = `Reason: ${ban.reason}`;
        s.ipBanExpiration = banExpiration(ban.expiresAt);
    });
    ipBanModal.show(true);
}
