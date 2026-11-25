import type { JSX } from "@solidjs/web";
import { Checkbox as CheckboxRoot, CheckboxIndicator } from "@ui-sdk/solid/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@ui-sdk/solid/select";
import { Slider, SliderControl, SliderThumb, SliderTrack } from "@ui-sdk/solid/slider";
import { For } from "solid-js";

/** the game reads mouse buttons on window: presses on menu controls must not shoot */
const stop = (e: Event) => e.stopPropagation();

/** a checkbox drawn by `.menu-checkbox` (app.css) */
export function Checkbox(props: {
    id?: string;
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <CheckboxRoot
            id={props.id}
            class="menu-checkbox"
            aria-label={props.label}
            checked={props.checked}
            onCheckedChange={(checked) => props.onChange(checked === true)}
        >
            <CheckboxIndicator class="menu-checkbox-check" aria-hidden="true" />
        </CheckboxRoot>
    );
}

/**
 * A horizontal slider. `class` picks the look: `slider` (teal, settings and volume)
 * or `crosshair-slider` (black, loadout).
 */
export function RangeSlider(props: {
    id?: string;
    class: string;
    label: string;
    min: number;
    max: number;
    step?: number;
    value: number;
    onChange: (value: number) => void;
}) {
    return (
        <Slider
            id={props.id}
            class={`range-slider ${props.class}`}
            min={props.min}
            max={props.max}
            step={props.step ?? 1}
            value={props.value}
            onValueChange={(value) => {
                if (typeof value === "number") props.onChange(value);
            }}
            onPointerDown={stop}
            onMouseDown={stop}
        >
            <SliderControl class="range-slider-control">
                <SliderTrack class="range-slider-track">
                    <SliderThumb class="range-slider-thumb" aria-label={props.label} />
                </SliderTrack>
            </SliderControl>
        </Slider>
    );
}

/**
 * A dropdown over a fixed list of values. The trigger takes the old `<select>`'s id and class,
 * so its CSS still applies; the list is `.menu-select-content` (app.css).
 */
export function MenuSelect<T extends string>(props: {
    id?: string;
    class?: string;
    label: string;
    value: T;
    values: readonly T[];
    itemLabel: (value: T) => string;
    itemId?: (value: T) => string;
    disabled?: boolean;
    onChange: (value: T) => void;
    /** shown above the items, like a native `<optgroup>` label */
    heading?: JSX.Element;
}) {
    return (
        <Select<T>
            value={props.value}
            disabled={props.disabled}
            onValueChange={(value) => {
                if (value !== null) props.onChange(value);
            }}
        >
            <SelectTrigger
                id={props.id}
                class={["menu-select-trigger", props.class]}
                aria-label={props.label}
                onMouseDown={stop}
            >
                {props.itemLabel(props.value)}
            </SelectTrigger>
            <SelectContent class="menu-select-content" alignItemWithTrigger onMouseDown={stop}>
                {props.heading && <div class="menu-select-heading">{props.heading}</div>}
                <For each={props.values}>
                    {(value) => (
                        <SelectItem class="menu-select-item" id={props.itemId?.(value)} value={value}>
                            {props.itemLabel(value)}
                        </SelectItem>
                    )}
                </For>
            </SelectContent>
        </Select>
    );
}
