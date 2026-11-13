import { ModelRuntime } from "@earendil-works/pi-coding-agent";
const rt: any = await ModelRuntime.create();
rt.registerVirtualModel({
  provider: "openai", id: "auto-router-test", name: "Auto Router", thinkingLevels: ["off"],
  route: async () => ({ model: rt.getModel("openai", "gpt-4o"), state: null }),
} as any);
const withVirtual = rt.getModels("openai").map((m:any)=>m.id);
const base = rt.composeProvider("openai");
const physical = (base?.models ?? []).map((m:any)=>m.id);
console.log("COUNT withVirtual=" + withVirtual.length + " physical=" + physical.length);
const virt = withVirtual.filter((id:string)=>!physical.includes(id));
console.log("VIRTUAL_ONLY=" + JSON.stringify(virt));
