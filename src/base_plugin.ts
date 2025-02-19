import type { ParamDescriptor, LabelText, SongAccess } from './descriptors';
import type { Song } from './models/song';
import * as _ from 'underscore';
import { nanoid } from 'nanoid';
import { WidgetType } from '.';

type RunParameters = { [paramName: string]: any };

export interface ReadAPIs {
  readAudioBuffer: (audioFile: string | File) => Promise<AudioBuffer | null | undefined>;
  translateLabel: (label: LabelText) => string;
  serializeSong: (song: Song) => Promise<string>;
  deserializeSong: (encodedSong: string) => Promise<Song>;
}

/**
 * The base class of a plugin.
 *
 * All plugins should be a sub-class of this plugin in order to run in the pipeline.
 */
export class TuneflowPlugin {
  private instanceIdInternal = TuneflowPlugin.generatePluginIdInternal();
  enabledInternal = true;
  private paramsResultInternal: RunParameters = {};
  // @ts-ignore
  private generatedTrackIdsInternal: string[] = [];
  private isRollbackable = false;
  /** Cache for the Song instance that was successfully produced in the last pipeline run. */
  // @ts-ignore
  private songCacheInternal?: Song;
  /** The execution progress. */
  private progress: number | null = null;
  private isExecuting = false;

  // ============ PUBLIC OVERWRITABLE ================

  /**
   * The unique id to identify the plugin provider.
   *
   * For example:
   * `friday-core`, `some-corp`, etc.
   */
  static providerId(): string {
    throw new Error('providerId() should be overwritten.');
  }

  /**
   * The unique plugin id under the provider's namespace.
   *
   * For example:
   * `melody-extractor`, `tune-analyzer`, etc.
   */
  static pluginId(): string {
    throw new Error('pluginId() should be overwritten.');
  }

  /**
   * The display name of the provider.
   */
  static providerDisplayName(): LabelText {
    throw new Error('providerDisplayName() should be overwritten.');
  }

  /**
   * The display name of the plugin.
   */
  static pluginDisplayName(): LabelText {
    throw new Error('pluginDisplayName() should be overwritten.');
  }

  /**
   * The description of this plugin.
   */
  static pluginDescription(): LabelText | null {
    return null;
  }

  /**
   * Whether to allow users to reset all parameters of this plugin.
   */
  static allowReset(): boolean {
    return true;
  }

  /**
   * Initializes the plugin instance.
   *
   * Override this method to initialize your plugin before it starts running.
   *
   * @param song The current version of the song, read-only.
   * @param readApis Apis to read data.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async init(song: Song, readApis: ReadAPIs) {}

  /**
   * Specify params to get from user input.
   *
   * Param input widgets will be displayed on the UI, and the inputs will be collected and fed into @run method.
   *
   * If you don't need any param, return `{}`;
   */
  params(): { [paramName: string]: ParamDescriptor } {
    return {};
  }

  /**
   * Provide the access this plugin needs to modify a song.
   */
  songAccess(): SongAccess {
    return {};
  }

  /**
   * Whether the user can manually apply this plugin and go back to adjust it.
   * Enable this when you want the user to frequently toggle this plugin on and off
   * to see the difference.
   * For example: A plugin that divides a track into two, you want the user to
   * easily switch between the plugin is on or off to see what's going on.
   */
  public allowManualApplyAdjust() {
    return false;
  }

  /**
   * The main logic here.
   *
   * It should return a map that contains the produced artifacts of this plugin.
   * Each artifact goes under a different artifactId.
   *
   * For example: `{ 'artifactId1': <output1>, 'artifactId2': <output2> }`
   *
   * @param song The song that is being processed. You can directly modify the song
   * by calling its methods.
   * @param params The results collected from user input specified by the `params` method.
   * @param readApis The APIs to read data.
   *
   */
  async run(
    // eslint-disable-next-line
    song: Song,
    // eslint-disable-next-line
    params: RunParameters,
    // eslint-disable-next-line
    readApis: ReadAPIs,
  ): Promise<void> {}

  // ============ PUBLIC NO OVERWRITE ================

  /**
   * Creates a plugin instance and initializes it.
   * @param song The current version of the song.
   */
  public static async create(song: Song, readApis: ReadAPIs) {
    const plugin = new this();
    plugin.resetInternal();
    await plugin.init(song, readApis);
    return plugin;
  }

  public get instanceId() {
    return this.instanceIdInternal;
  }

  /**
   * DO NOT overwrite this method.
   *
   * Gets a typed param.
   * @param params The `params` from `run` method input.
   */
  public getParam<T>(params: RunParameters, paramName: string) {
    return params[paramName] as T;
  }

  /**
   * DO NOT overwrite this method.
   * @final
   * @returns Whether all params has been set.
   */
  public hasAllParamsSet(): boolean {
    for (const paramName of _.keys(this.params())) {
      const paramProvided = this.isParamProvided(paramName);
      if (!paramProvided) {
        return false;
      }
    }
    return true;
  }

  public isParamProvided(paramName: string) {
    if (this.params()[paramName].optional) {
      return true;
    }
    const paramResult = this.paramsResultInternal[paramName];
    if (paramResult === undefined || paramResult === null) {
      return false;
    }
    // If the param is a non-primitive value(like an object),
    // we need to do additional check.
    const paramDescriptor = this.params()[paramName];
    const paramWidgetType = paramDescriptor.widget.type;
    switch (paramWidgetType) {
      case WidgetType.Input:
      case WidgetType.Pitch:
      case WidgetType.Slider:
      case WidgetType.TrackSelector:
      case WidgetType.Select:
      case WidgetType.SelectList:
      case WidgetType.Switch:
      case WidgetType.InputNumber:
      case WidgetType.FileSelector:
        // Nothing else to check.
        return true;
      case WidgetType.MultiTrackSelector:
        return paramResult.length > 0;
      case WidgetType.TrackPitchSelector:
        return (
          paramResult.track !== undefined &&
          paramResult.track !== null &&
          paramResult.pitch !== undefined &&
          paramResult.pitch !== null
        );
      case WidgetType.InstrumentSelector:
        return (
          paramResult.program !== undefined &&
          paramResult.program !== null &&
          paramResult.isDrum !== undefined &&
          paramResult.isDrum !== null
        );
      case WidgetType.MultiSourceAudioSelector:
        return (
          paramResult !== undefined &&
          paramResult !== null &&
          paramResult.audioInfo !== undefined &&
          paramResult.audioInfo !== null
        );
      case WidgetType.None:
        return paramResult !== undefined && paramResult !== null;
      default:
        throw new Error(
          `Param nullness check needs to be implemented for widget type ${paramWidgetType}. Either use default nullness check or define custom logic.`,
        );
    }
  }

  /**
   * DO NOT overwrite this method.
   * @final
   * @returns The unique identifier for the plugin CLASS, which is the combination of providerId and moduleId. NOTE: this is not the id of the plugin instance.
   */
  public static id(): string {
    return `${this.providerId()}^_^${this.pluginId()}`;
  }

  /**
   * DO NOT overwrite this method.
   * @final
   * @returns The universal unique identifier for this artifact.
   */
  public static getPrefixedArtifactId(artifactId: string) {
    return `${this.id()}.${artifactId}`;
  }

  /** Sets the current execution progress (0 - 1). */
  public setProgress(progress: number | null) {
    this.progress = progress;
  }

  /**
   * Gets the current execution progress.
   *
   * Only numeric return is considered valid.
   */
  public getProgress() {
    return this.progress;
  }

  /** Whether the `run` method is running. */
  public getIsExecuting() {
    return this.isExecuting;
  }

  // ============ INTERNAL BELOW ================

  /**
   * DO NOT overwrite this method.
   *
   * The host of the pipeline should call this method to set params for the plugins before running the pipeline.
   * @final
   */
  public setParamsInternal(params: { [paramName: string]: any }) {
    this.paramsResultInternal = params;
    this.maybeSyncEnabledWithParamsReadiness();
  }

  /**
   * DO NOT overwrite this method.
   * @final
   */
  public getParamsInternal() {
    return this.paramsResultInternal;
  }

  /**
   * DO NOT overwrite this method.
   *
   * Resets the parameters of this plugin.
   * @final
   */
  public resetParamsInternal() {
    for (const key of _.keys(this.params())) {
      const paramDescriptor = this.params()[key];
      this.paramsResultInternal[key] = paramDescriptor.defaultValue;
    }
    this.maybeSyncEnabledWithParamsReadiness();
  }

  /**
   * DO NOT overwrite this method.
   *
   * Resets the whole plugin, including states.
   * @final
   */
  public resetInternal() {
    this.resetParamsInternal();
    if (this.allowManualApplyAdjust()) {
      this.enabledInternal = false;
    }
  }

  public setEnabledInternal(enabled: boolean) {
    this.enabledInternal = enabled;
  }

  /**
   * If the plugin is manually enabled, and params are not ready,
   * the plugin should be disabled.
   */
  private maybeSyncEnabledWithParamsReadiness() {
    if (this.allowManualApplyAdjust() && !this.hasAllParamsSet()) {
      this.setEnabledInternal(false);
    }
  }

  private static generatePluginIdInternal() {
    return nanoid(10);
  }
}
