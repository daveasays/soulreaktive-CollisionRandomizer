import {
  initialize,
  type ActivationContext,
  type Handle,
  MidiTrack,
  Device,
  DeviceParameter,
} from "@ableton-extensions/sdk";

import dialInterface from "./dial.html";

const EXCLUDED_PARAMS = new Set([
  "Device On",
  "Volume",
  "Res 1 Tune",
  "Res 2 Tune",
  "Res 1 Fine Tune",
  "Res 2 Fine Tune",
]);

const RES_ON_PARAMS    = ["Res 1 On/Off", "Res 2 On/Off"];
const MALLET_ON_PARAM  = "Mallet On/Off";
const NOISE_ON_PARAM   = "Noise On/Off";
const LFO_ON_PARAMS    = ["LFO 1 On/Off", "LFO 2 On/Off"];

// -10dB = 0.5623, -20dB = 0.3162 — cible -12dB ≈ 0.50
const VOLUME_MAX = 0.50;

function randomizeParam(param: DeviceParameter<"1.0.0">, intensity: number): number {
  const range = param.max - param.min;
  if (param.isQuantized) {
    const items = param.valueItems;
    const count = items.length > 0 ? items.length : Math.round(range) + 1;
    const randomIndex = Math.floor(Math.random() * count);
    return param.min + randomIndex;
  }
  const center = (param.min + param.max) / 2;
  const targetRandom = param.min + Math.random() * range;
  return center + (targetRandom - center) * intensity;
}

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand("collision.randomize", async (arg: unknown) => {
    const handle = arg as Handle;
    const track = context.getObjectFromHandle(handle, MidiTrack);

    const collisionDevices = track.devices.filter((d: Device<"1.0.0">) => {
      const names = new Set(d.parameters.map((p: DeviceParameter<"1.0.0">) => p.name));
      return names.has("Res 1 On/Off") && names.has("Mallet On/Off") && names.has("Res 1 Material");
    });

    if (collisionDevices.length === 0) {
      console.log(`[Collision Randomizer] Aucun Collision sur "${track.name}".`);
      return;
    }

    let result: string;
    try {
      result = await context.ui.showModalDialog(
        `data:text/html,${encodeURIComponent(dialInterface)}`,
        320,
        340
      );
    } catch {
      console.log("[Collision Randomizer] Annulé.");
      return;
    }

    const parsed = JSON.parse(result) as { intensity: number | null };
    if (parsed.intensity === null) {
      console.log("[Collision Randomizer] Annulé.");
      return;
    }

    const intensity = parsed.intensity;

    for (const device of collisionDevices) {
      const allParams = device.parameters;

      const resOnParams = allParams.filter(
        (p: DeviceParameter<"1.0.0">) => RES_ON_PARAMS.includes(p.name)
      );
      const malletOnParam = allParams.find(
        (p: DeviceParameter<"1.0.0">) => p.name === MALLET_ON_PARAM
      );
      const noiseOnParam = allParams.find(
        (p: DeviceParameter<"1.0.0">) => p.name === NOISE_ON_PARAM
      );
      const lfoOnParams = allParams.filter(
        (p: DeviceParameter<"1.0.0">) => LFO_ON_PARAMS.includes(p.name)
      );
      const volumeParam = allParams.find(
        (p: DeviceParameter<"1.0.0">) => p.name === "Volume"
      );
      const randomizableParams = allParams.filter(
        (p: DeviceParameter<"1.0.0">) =>
          !EXCLUDED_PARAMS.has(p.name) &&
          !RES_ON_PARAMS.includes(p.name) &&
          !LFO_ON_PARAMS.includes(p.name) &&
          p.name !== MALLET_ON_PARAM &&
          p.name !== NOISE_ON_PARAM
      );

      await context.withinTransaction(() =>
        Promise.all([
          // 1. Randomiser tous les paramètres normaux
          ...randomizableParams.map(async (param: DeviceParameter<"1.0.0">) => {
            try {
              await param.setValue(randomizeParam(param, intensity));
            } catch (e) {
              console.log(`  ✗ ${param.name}: skipped (${e})`);
            }
          }),
          // 2. Res 1 et Res 2 — 75% ON chacun
          ...resOnParams.map(async (param: DeviceParameter<"1.0.0">) =>
            param.setValue(Math.random() < 0.25 ? 0 : 1)
          ),
          // 3. Mallet — 75% ON
          ...(malletOnParam ? [malletOnParam.setValue(Math.random() < 0.25 ? 0 : 1)] : []),
          // 4. Noise — 30% ON
          ...(noiseOnParam ? [noiseOnParam.setValue(Math.random() < 0.7 ? 0 : 1)] : []),
          // 5. LFOs — 60% ON chacun
          ...lfoOnParams.map(async (param: DeviceParameter<"1.0.0">) =>
            param.setValue(Math.random() < 0.4 ? 0 : 1)
          ),
        ])
      );

      // 6. Garantir au moins un résonateur actif
      const resOnValues = await Promise.all(
        resOnParams.map((p: DeviceParameter<"1.0.0">) => p.getValue())
      );
      const anyResOn = resOnValues.some((v) => v > 0);
      if (!anyResOn) {
        const res1 = resOnParams.find((p: DeviceParameter<"1.0.0">) => p.name === "Res 1 On/Off");
        if (res1) await res1.setValue(1);
        console.log("[Collision Randomizer] Aucun résonateur actif — Res 1 forcé à ON.");
      }

      // 7. Volume -12dB
      if (volumeParam) await volumeParam.setValue(VOLUME_MAX);

      console.log(`[Collision Randomizer] ✓ "${track.name}" — ${Math.round(intensity * 100)}% — volume -12dB.`);
    }
  });

  context.ui.registerContextMenuAction(
    "MidiTrack",
    "Randomize Collision",
    "collision.randomize"
  );

  console.log("[Collision Randomizer] Activé.");
}
