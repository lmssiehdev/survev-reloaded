import { For } from "solid-js";
import { device } from "../../device.ts";
import {
    EMOTE_WEDGES,
    emoteBarnRef,
    type EmoteWedge,
    emoteWheel,
    PING_WEDGES,
    type PingWedge,
    type WedgeView,
    type WheelView,
} from "../emoteWheel.ts";
import { onNative } from "../nativeEvent.ts";

type AnyWedge = EmoteWedge | PingWedge;

/** the ping wheel's two extra wedges are eighths */
const SHAPES: Record<AnyWedge, "circle" | "quarter" | "eighth"> = {
    middle: "circle",
    top: "quarter",
    right: "quarter",
    bottom: "quarter",
    left: "quarter",
    "bottom-left": "eighth",
    "top-left": "eighth",
};

const touchEvents = () => (emoteWheel.touch ? "auto" : undefined);

/** a touch on a wedge picks it (EmoteBarn resolves which one from the position) */
const onWedgeTouch = onNative("touchstart", (e) => {
    const barn = emoteBarnRef();
    if (!barn || !device.touch) return;
    e.stopPropagation();
    barn.onWheelTouch(e.changedTouches[0].pageX, e.changedTouches[0].pageY);
});

function Wedge(props: { id: string; key: AnyWedge; index: number; dataKey: boolean; view: WedgeView }) {
    const shape = () => SHAPES[props.key];
    return (
        <div
            id={props.id}
            class={[`ui-emote-${props.key}`, `ui-emote-${shape()}`, "ui-emote-parent"]}
            data-key={props.dataKey ? props.key : undefined}
            data-id={props.index}
            style={{ opacity: props.view.opacity }}
        >
            <div
                class={["ui-emote", `ui-emote-bg-${shape()}`]}
                style={{ "pointer-events": touchEvents() }}
                ref={onWedgeTouch}
            />
            <div
                class="ui-emote ui-emote-hl"
                style={{
                    display: props.view.highlight ? "block" : "none",
                    "pointer-events": touchEvents(),
                }}
                ref={onWedgeTouch}
            />
            <div
                class={["ui-emote-image", shape() === "eighth" ? "ui-emote-image-small" : "ui-emote-image-large"]}
                style={{ "background-image": props.view.image ? `url(${props.view.image})` : undefined }}
            />
        </div>
    );
}

function Wheel<K extends AnyWedge>(props: {
    id: string;
    wedgeId: string;
    keys: readonly K[];
    dataKey: boolean;
    view: WheelView<K>;
}) {
    const px = (v: number | undefined) => (v === undefined ? undefined : `${v}px`);
    return (
        <div
            id={props.id}
            class="ui-emote-wheel"
            style={{
                display: props.view.open ? "block" : "none",
                left: px(props.view.left),
                top: px(props.view.top),
                opacity: emoteWheel.opacity,
            }}
        >
            <For each={props.keys}>
                {(key, i) => (
                    <Wedge
                        id={`${props.wedgeId}-${key}`}
                        key={key}
                        index={i()}
                        dataKey={props.dataKey}
                        view={props.view.wedges[key]}
                    />
                )}
            </For>
        </div>
    );
}

/** `#ui-emotes` (hold the emote bind) and `#ui-team-pings` (hold the team ping bind) */
export function EmoteWheels() {
    return (
        <>
            <Wheel<EmoteWedge> id="ui-emotes" wedgeId="ui-emote" keys={EMOTE_WEDGES} dataKey view={emoteWheel.emotes} />
            <Wheel<PingWedge>
                id="ui-team-pings"
                wedgeId="ui-team-ping"
                keys={PING_WEDGES}
                dataKey={false}
                view={emoteWheel.pings}
            />
        </>
    );
}

/** touch devices: press to open the emote wheel at the screen center */
export function EmoteButton() {
    return (
        <div
            id="ui-emote-button"
            style={{
                display: device.touch ? "block" : "none",
                "pointer-events": touchEvents(),
            }}
            ref={onNative("touchstart", (e) => {
                const barn = emoteBarnRef();
                if (!barn || !device.touch) return;
                e.stopPropagation();
                barn.onEmoteButtonTouch();
            })}
        />
    );
}
