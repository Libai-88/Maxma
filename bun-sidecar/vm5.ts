import { ModelRuntime } from "@earendil-works/pi-coding-agent";
const rt: any = await ModelRuntime.create();
rt.registerVirtualModel({
  provider: "openai", id: "auto-router-test", name: "Auto Router", thinkingLevels: ["off"],
  route: async () => ({ model: rt.getModel("openai", "gpt-4o"), state: null }),
} as any);

const allIds = rt.getAllModels().map((m:any)=>`${m.provider}/${m.id}`);
const physIds = rt.getModels().map((m:any)=>`${m.provider}/${m.id}`);
console.log("all=" + allIds.length + " phys=" + physIds.length);
const physSet = new Set(physIds);
const onlyAll = allIds.filter((x:string)=>!physSet.has(x));
console.log("ONLY_IN_ALL=" + JSON.stringify(onlyAll));
const allSet = new Set(allIds);
const onlyPhys = physIds.filter((x:string)=>!allSet.has(x));
console.log("ONLY_IN_PHYS=" + JSON.stringify(onlyPhys));
