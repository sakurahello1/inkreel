import type { Job } from "../core/job";
import { enqueue, registerJob, startRunner } from "./runner";

import { PersonaSheetJob } from "./persona-sheet";
import { PropSheetJob } from "./prop-sheet";
import { SceneSheetJob } from "./scene-sheet";
import { ShotFrameJob } from "./shot-frame";
import { ShotKeyframeJob } from "./shot-keyframe";
import { VideoPollJob, VideoSubmitJob } from "./shot-video";
import { CharacterVoiceJob } from "./character-voice";
import { ChapterStoryboardJob, ShotRewriteJob } from "./agent-jobs";
import { ChapterExportJob } from "./chapter-export";
import { PrevizPollJob, PrevizSubmitJob } from "./chapter-previz";
import { ChapterPagesJob } from "./chapter-pages";
import { UtteranceTtsJob } from "./utterance-tts";
import { PageRenderJob } from "./page-render";
import { ProjectCastJob } from "./project-cast";
import { PersonaSpriteJob } from "./persona-sprite";

export { enqueue };

/**
 * 任务注册表。
 *
 * 这个文件只做一件事：把所有任务类实例化并登记到队列。
 * 每个任务的实现各在自己的文件里，改一个任务不会碰到别的任务。
 */
const JOBS: Job<never>[] = [
  new PersonaSheetJob(),
  new PropSheetJob(),
  new SceneSheetJob(),
  new ShotFrameJob(),
  new ShotKeyframeJob(),
  new VideoSubmitJob(),
  new VideoPollJob(),
  new CharacterVoiceJob(),
  new ChapterStoryboardJob(),
  new ShotRewriteJob(),
  new ChapterExportJob(),
  new PrevizSubmitJob(),
  new PrevizPollJob(),
  new ChapterPagesJob(),
  new UtteranceTtsJob(),
  new PageRenderJob(),
  new ProjectCastJob(),
  new PersonaSpriteJob(),
] as unknown as Job<never>[];

for (const job of JOBS) registerJob(job.type, job.toHandler());

/** 任务类型名 → 任务实例，供排查与测试用 */
export const jobRegistry = new Map(JOBS.map((j) => [j.type, j]));

export function startJobs() {
  startRunner();
}
