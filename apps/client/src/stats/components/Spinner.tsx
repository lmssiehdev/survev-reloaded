import { Show } from "solid-js";

type SpinnerKind = "leaderboard" | "player" | "match-history" | "match-data";

export function Spinner(props: { kind: SpinnerKind }) {
    const spinner = () => (
        <div class={`col-12 spinner-wrapper-${props.kind}`}>
            <div class="spinner"></div>
        </div>
    );
    return (
        <Show when={props.kind === "player"} fallback={spinner()}>
            <div class="container">{spinner()}</div>
        </Show>
    );
}
