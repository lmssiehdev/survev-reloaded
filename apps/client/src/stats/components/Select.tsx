import { Select as SelectRoot, SelectContent, SelectItem, SelectTrigger } from "@ui-sdk/solid/select";
import { For } from "solid-js";

/** a dropdown over a fixed list of values; the trigger keeps Bootstrap's `custom-select` look */
export function Select<T extends string>(props: {
    id: string;
    class: string;
    /** what the dropdown picks, for screen readers */
    name: string;
    value: T;
    values: readonly T[];
    label: (value: T) => string;
    onChange: (value: T) => void;
}) {
    return (
        <SelectRoot<T>
            value={props.value}
            onValueChange={(value) => {
                if (value !== null) props.onChange(value);
            }}
        >
            <SelectTrigger
                id={props.id}
                class={`${props.class} custom-select stats-select-trigger`}
                aria-label={props.name}
            >
                {props.label(props.value)}
            </SelectTrigger>
            <SelectContent class="stats-select-content" alignItemWithTrigger>
                <For each={props.values}>
                    {(value) => <SelectItem class="stats-select-item" value={value}>{props.label(value)}</SelectItem>}
                </For>
            </SelectContent>
        </SelectRoot>
    );
}
