import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";
const crons = cronJobs();
crons.interval("temporary bridge cleanup", { minutes: 5 }, internal.bridge.sweep, {});
export default crons;
