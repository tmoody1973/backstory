/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as aws_extract from "../aws/extract.js";
import type * as aws_geocode from "../aws/geocode.js";
import type * as aws_transcribe from "../aws/transcribe.js";
import type * as extractions from "../extractions.js";
import type * as geocoding from "../geocoding.js";
import type * as ingest from "../ingest.js";
import type * as jobs from "../jobs.js";
import type * as lib_attribution from "../lib/attribution.js";
import type * as lib_cds from "../lib/cds.js";
import type * as lib_evidence from "../lib/evidence.js";
import type * as lib_extraction from "../lib/extraction.js";
import type * as lib_geocode from "../lib/geocode.js";
import type * as lib_shows from "../lib/shows.js";
import type * as lib_steps from "../lib/steps.js";
import type * as lib_taxonomy from "../lib/taxonomy.js";
import type * as lib_transcribeOutput from "../lib/transcribeOutput.js";
import type * as public_ from "../public.js";
import type * as stories from "../stories.js";
import type * as transcripts from "../transcripts.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  "aws/extract": typeof aws_extract;
  "aws/geocode": typeof aws_geocode;
  "aws/transcribe": typeof aws_transcribe;
  extractions: typeof extractions;
  geocoding: typeof geocoding;
  ingest: typeof ingest;
  jobs: typeof jobs;
  "lib/attribution": typeof lib_attribution;
  "lib/cds": typeof lib_cds;
  "lib/evidence": typeof lib_evidence;
  "lib/extraction": typeof lib_extraction;
  "lib/geocode": typeof lib_geocode;
  "lib/shows": typeof lib_shows;
  "lib/steps": typeof lib_steps;
  "lib/taxonomy": typeof lib_taxonomy;
  "lib/transcribeOutput": typeof lib_transcribeOutput;
  public: typeof public_;
  stories: typeof stories;
  transcripts: typeof transcripts;
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
