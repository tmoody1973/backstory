/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aws_geocode from "../aws/geocode.js";
import type * as geocoding from "../geocoding.js";
import type * as jobs from "../jobs.js";
import type * as lib_evidence from "../lib/evidence.js";
import type * as lib_geocode from "../lib/geocode.js";
import type * as lib_shows from "../lib/shows.js";
import type * as lib_steps from "../lib/steps.js";
import type * as lib_taxonomy from "../lib/taxonomy.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "aws/geocode": typeof aws_geocode;
  geocoding: typeof geocoding;
  jobs: typeof jobs;
  "lib/evidence": typeof lib_evidence;
  "lib/geocode": typeof lib_geocode;
  "lib/shows": typeof lib_shows;
  "lib/steps": typeof lib_steps;
  "lib/taxonomy": typeof lib_taxonomy;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
