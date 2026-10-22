import { zUpdateRegionBody } from "@survev/contracts";
import { Hono } from "hono";
import { validateParams } from "../lib/middleware.ts";
import { updateRegion } from "./regions.ts";

/** /private/update_region: each game server registers its region and reports its player count */
export const GamePrivateRouter = new Hono()
    .post("/update_region", validateParams(zUpdateRegionBody), (c) => {
        const { regionId, data } = c.req.valid("json");

        updateRegion(regionId, data);
        return c.json({}, 200);
    });
