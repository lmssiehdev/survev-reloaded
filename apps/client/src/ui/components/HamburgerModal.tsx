import { hamburgerModal } from "../appModals.ts";
import { t } from "../i18n.ts";
import { Modal } from "./Modal.tsx";

/** the mobile menu behind the top-left hamburger button */
export function HamburgerModal() {
    return (
        <Modal
            modal={hamburgerModal}
            id="modal-hamburger"
            title={"\u00a0"}
            closeClass="close-hamburger icon-hamburger"
            bodyId="modal-hamburger-body"
        >
            <div id="modal-hamburger-leaderboards">
                <a href="/stats" target="_blank" class="btn-leaderboard-stats-link menu-option btn-darken">
                    {t("index-leaderboards")}
                </a>
            </div>
            {/* (social links used to sit between the dividers) */}
            <div class="modal-divider"></div>
            <div class="modal-divider"></div>
            <div id="modal-hamburger-bottom">
                <a href="changelogRec.html" class="footer-after">ver {import.meta.env.VITE_GAME_VERSION}</a>
                <a href="attribution.txt" target="_blank">attributions</a>
            </div>
        </Modal>
    );
}
