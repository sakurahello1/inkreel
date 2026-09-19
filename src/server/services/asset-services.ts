import { enqueue } from "../jobs";
import { listSystemVoices } from "../providers/minimax";
import { Service } from "./base";

/** 项目本身：基础信息、世界观、画风参考图、视频引擎 */
export class ProjectService extends Service {
  create(title: string, kind: "drama" | "narrated" = "drama") {
    // 说书默认横屏：对话框式的惯例，也更像有声漫画
    return this.db.project.create({ data: { title: title.trim() || "未命名项目", kind, ...(kind === "narrated" ? { orientation: "16:9" } : {}) } });
  }

  updateBasics(projectId: string, data: { title?: string; genre?: string; orientation?: string; targetEpisodes?: number }) {
    return this.db.project.update({ where: { id: projectId }, data });
  }

  updateWorld(projectId: string, data: { world?: string; style?: string }) {
    return this.db.project.update({ where: { id: projectId }, data });
  }

  updateVideoEngine(projectId: string, data: { videoEngine?: string; videoResolution?: string; imageQuality?: string; textOnlyRefs?: boolean }) {
    return this.db.project.update({ where: { id: projectId }, data });
  }

  async addStyleRef(projectId: string, form: FormData) {
    const { asset } = await this.saveUpload(form, { projectId, folder: "style", kind: "image" });
    const order = await this.db.styleRef.count({ where: { projectId } });
    return this.db.styleRef.create({ data: { projectId, assetId: asset.id, order } });
  }

  removeStyleRef(styleRefId: string) {
    return this.db.styleRef.delete({ where: { id: styleRefId } });
  }
}

/** 人物、人设（三视图）、音色 */
export class CharacterService extends Service {
  async create(projectId: string, name: string) {
    const order = await this.db.character.count({ where: { projectId } });
    const c = await this.db.character.create({ data: { projectId, name: name.trim() || "新人物", order } });
    return c.id;
  }

  update(
    characterId: string,
    data: { name?: string; age?: string; role?: string; personality?: string; catchphrase?: string; relations?: string },
  ) {
    return this.db.character.update({ where: { id: characterId }, data });
  }

  remove(characterId: string) {
    return this.db.character.delete({ where: { id: characterId } });
  }

  async createPersona(characterId: string, data: { tag: string; description: string }) {
    const order = await this.db.persona.count({ where: { characterId } });
    const p = await this.db.persona.create({ data: { characterId, tag: data.tag.trim() || "默认", description: data.description, order } });
    return p.id;
  }

  updatePersona(personaId: string, data: { tag?: string; description?: string; prompt?: string }) {
    return this.db.persona.update({ where: { id: personaId }, data });
  }

  removePersona(personaId: string) {
    return this.db.persona.delete({ where: { id: personaId } });
  }

  async generateSheet(personaId: string) {
    await this.db.persona.update({ where: { id: personaId }, data: { status: "generating", error: "" } });
    await enqueue("persona.sheet", { personaId });
  }

  async uploadSheet(projectId: string, personaId: string, form: FormData) {
    const { asset } = await this.saveUpload(form, { projectId, folder: "sheets", kind: "image" });
    await this.db.persona.update({ where: { id: personaId }, data: { sheetId: asset.id, status: "ready", error: "" } });
  }

  /** MiniMax 现成音色列表；接口挂了不抛异常，返回错误让界面自己降级 */
  async voiceOptions() {
    try {
      const voices = await listSystemVoices();
      return voices.map((v) => ({ voiceId: v.voiceId, name: v.name }));
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async useSystemVoice(characterId: string, voiceId: string, label: string) {
    await this.db.character.update({
      where: { id: characterId },
      data: { voiceSource: "minimax_system", voiceId, voiceLabel: `MiniMax · ${label}`, voiceStatus: "generating", voiceError: "", voiceSampleId: null },
    });
    await enqueue("character.voice", { characterId });
  }

  async uploadVoice(projectId: string, characterId: string, form: FormData) {
    const { asset, file } = await this.saveUpload(form, {
      projectId,
      folder: "voices",
      kind: "audio",
      defaultMime: form.get("file") instanceof File && String((form.get("file") as File).name).toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg",
    });
    await this.db.character.update({
      where: { id: characterId },
      data: { voiceSource: "upload", voiceId: null, voiceLabel: `上传 · ${file.name}`, voiceSampleId: asset.id, voiceStatus: "ready", voiceError: "" },
    });
  }
}

/** 道具与它的概念图 */
export class PropService extends Service {
  async create(projectId: string, data: { name: string; description: string }) {
    const order = await this.db.prop.count({ where: { projectId } });
    const p = await this.db.prop.create({ data: { projectId, name: data.name.trim() || "新道具", description: data.description, order } });
    return p.id;
  }

  update(propId: string, data: { name?: string; description?: string; prompt?: string }) {
    return this.db.prop.update({ where: { id: propId }, data });
  }

  remove(propId: string) {
    return this.db.prop.delete({ where: { id: propId } });
  }

  async generateSheet(propId: string) {
    await this.db.prop.update({ where: { id: propId }, data: { status: "generating", error: "" } });
    await enqueue("prop.sheet", { propId });
  }

  async uploadSheet(projectId: string, propId: string, form: FormData) {
    const { asset } = await this.saveUpload(form, { projectId, folder: "props", kind: "image" });
    await this.db.prop.update({ where: { id: propId }, data: { sheetId: asset.id, status: "ready", error: "" } });
  }
}

/** 场景库：与道具库同构，只是产物是空间基准图 */
export class SceneService extends Service {
  async create(projectId: string, data: { name: string; description: string }) {
    const order = await this.db.scene.count({ where: { projectId } });
    const s = await this.db.scene.create({ data: { projectId, name: data.name.trim() || "新场景", description: data.description, order } });
    return s.id;
  }

  update(sceneId: string, data: { name?: string; description?: string; prompt?: string }) {
    return this.db.scene.update({ where: { id: sceneId }, data });
  }

  remove(sceneId: string) {
    return this.db.scene.delete({ where: { id: sceneId } });
  }

  async generateSheet(sceneId: string) {
    await this.db.scene.update({ where: { id: sceneId }, data: { status: "generating", error: "" } });
    await enqueue("scene.sheet", { sceneId });
  }

  async uploadSheet(projectId: string, sceneId: string, form: FormData) {
    const { asset } = await this.saveUpload(form, { projectId, folder: "scenes", kind: "image" });
    await this.db.scene.update({ where: { id: sceneId }, data: { sheetId: asset.id, status: "ready", error: "" } });
  }
}

/** 音乐库 */
export class BgmService extends Service {
  async add(projectId: string, form: FormData) {
    const raw = form.get("file");
    const isWav = raw instanceof File && raw.name.toLowerCase().endsWith(".wav");
    const { asset, file } = await this.saveUpload(form, { projectId, folder: "bgm", kind: "audio", defaultMime: isWav ? "audio/wav" : "audio/mpeg" });
    const order = await this.db.bgmTrack.count({ where: { projectId } });
    const name = String(form.get("name") || "").trim() || file.name.replace(/[.][a-z0-9]+$/i, "");
    const t = await this.db.bgmTrack.create({
      data: {
        projectId,
        assetId: asset.id,
        name,
        mood: String(form.get("mood") || "").trim(),
        description: String(form.get("description") || "").trim(),
        order,
      },
    });
    return t.id;
  }

  update(trackId: string, data: { name?: string; mood?: string; description?: string; volume?: number }) {
    return this.db.bgmTrack.update({ where: { id: trackId }, data });
  }

  remove(trackId: string) {
    return this.db.bgmTrack.delete({ where: { id: trackId } });
  }

  /** 给若干镜头指定 BGM，不影响审定状态 */
  assign(chapterId: string, shotIds: string[], trackId: string | null) {
    return this.db.shot.updateMany({ where: { id: { in: shotIds }, chapterId }, data: { bgmTrackId: trackId } });
  }

  /** 是否把本镜对应的那段 BGM 作为参考音频送给视频模型 */
  setSendToModel(chapterId: string, shotIds: string[], on: boolean) {
    return this.db.shot.updateMany({ where: { id: { in: shotIds }, chapterId }, data: { bgmToModel: on } });
  }
}
