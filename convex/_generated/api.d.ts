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
import type * as aws_pinLocation from "../aws/pinLocation.js";
import type * as aws_placeDetails from "../aws/placeDetails.js";
import type * as aws_transcribe from "../aws/transcribe.js";
import type * as bookingLink from "../bookingLink.js";
import type * as crons from "../crons.js";
import type * as deepgram from "../deepgram.js";
import type * as extractions from "../extractions.js";
import type * as geocoding from "../geocoding.js";
import type * as ingest from "../ingest.js";
import type * as jevPeople from "../jevPeople.js";
import type * as jevTopics from "../jevTopics.js";
import type * as jobs from "../jobs.js";
import type * as lib_approveRun from "../lib/approveRun.js";
import type * as lib_askStory from "../lib/askStory.js";
import type * as lib_attention from "../lib/attention.js";
import type * as lib_attribution from "../lib/attribution.js";
import type * as lib_bookingLink from "../lib/bookingLink.js";
import type * as lib_cds from "../lib/cds.js";
import type * as lib_deepgram from "../lib/deepgram.js";
import type * as lib_evidence from "../lib/evidence.js";
import type * as lib_extraction from "../lib/extraction.js";
import type * as lib_geocode from "../lib/geocode.js";
import type * as lib_jevPeople from "../lib/jevPeople.js";
import type * as lib_jevTopics from "../lib/jevTopics.js";
import type * as lib_placeDetails from "../lib/placeDetails.js";
import type * as lib_placeDirectory from "../lib/placeDirectory.js";
import type * as lib_reviewAuth from "../lib/reviewAuth.js";
import type * as lib_reviewers from "../lib/reviewers.js";
import type * as lib_shows from "../lib/shows.js";
import type * as lib_speakers from "../lib/speakers.js";
import type * as lib_steps from "../lib/steps.js";
import type * as lib_storySearch from "../lib/storySearch.js";
import type * as lib_taxonomy from "../lib/taxonomy.js";
import type * as lib_transcribeOutput from "../lib/transcribeOutput.js";
import type * as public_ from "../public.js";
import type * as review from "../review.js";
import type * as reviewMutations from "../reviewMutations.js";
import type * as sonnetExtract from "../sonnetExtract.js";
import type * as speakers from "../speakers.js";
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
  "aws/pinLocation": typeof aws_pinLocation;
  "aws/placeDetails": typeof aws_placeDetails;
  "aws/transcribe": typeof aws_transcribe;
  bookingLink: typeof bookingLink;
  crons: typeof crons;
  deepgram: typeof deepgram;
  extractions: typeof extractions;
  geocoding: typeof geocoding;
  ingest: typeof ingest;
  jevPeople: typeof jevPeople;
  jevTopics: typeof jevTopics;
  jobs: typeof jobs;
  "lib/approveRun": typeof lib_approveRun;
  "lib/askStory": typeof lib_askStory;
  "lib/attention": typeof lib_attention;
  "lib/attribution": typeof lib_attribution;
  "lib/bookingLink": typeof lib_bookingLink;
  "lib/cds": typeof lib_cds;
  "lib/deepgram": typeof lib_deepgram;
  "lib/evidence": typeof lib_evidence;
  "lib/extraction": typeof lib_extraction;
  "lib/geocode": typeof lib_geocode;
  "lib/jevPeople": typeof lib_jevPeople;
  "lib/jevTopics": typeof lib_jevTopics;
  "lib/placeDetails": typeof lib_placeDetails;
  "lib/placeDirectory": typeof lib_placeDirectory;
  "lib/reviewAuth": typeof lib_reviewAuth;
  "lib/reviewers": typeof lib_reviewers;
  "lib/shows": typeof lib_shows;
  "lib/speakers": typeof lib_speakers;
  "lib/steps": typeof lib_steps;
  "lib/storySearch": typeof lib_storySearch;
  "lib/taxonomy": typeof lib_taxonomy;
  "lib/transcribeOutput": typeof lib_transcribeOutput;
  public: typeof public_;
  review: typeof review;
  reviewMutations: typeof reviewMutations;
  sonnetExtract: typeof sonnetExtract;
  speakers: typeof speakers;
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
