import { For } from "solid-js";
import { type StatsKey, t } from "../i18n.ts";

/** a native select over a fixed list of values, labeled with stats l10n keys */
export function Select<T extends string>(props: {
    id: string;
    class: string;
    value: T;
    values: readonly T[];
    labels: Record<T, StatsKey>;
    onChange: (value: T) => void;
}) {
    return (
        <select
            id={props.id}
            class={`${props.class} custom-select`}
            value={props.value}
            onChange={(e) => props.onChange(e.currentTarget.value as T)}
        >
            <For each={props.values}>
                {(value) => <option value={value}>{t(props.labels[value])}</option>}
            </For>
        </select>
    );
}
