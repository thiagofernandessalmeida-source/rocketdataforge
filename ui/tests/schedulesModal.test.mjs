import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Fase 1: Agendador Cron & Webhooks (UI - T-1.4)", () => {
  test("T-1.4: types/index.ts deve exportar ScheduleItem e ScheduleCreateData", () => {
    const typesFile = path.resolve(__dirname, "../src/types/index.ts");
    const content = fs.readFileSync(typesFile, "utf-8");

    assert.ok(content.includes("export interface ScheduleItem"), "Deve conter ScheduleItem");
    assert.ok(content.includes("export interface ScheduleCreateData"), "Deve conter ScheduleCreateData");
    assert.ok(content.includes("concurrency_policy"), "Deve incluir concurrency_policy");
    assert.ok(content.includes("webhook_url"), "Deve incluir webhook_url");
  });

  test("T-1.4: api/client.ts deve expor métodos completos para gerenciamento de agendamentos", () => {
    const apiFile = path.resolve(__dirname, "../src/api/client.ts");
    const content = fs.readFileSync(apiFile, "utf-8");

    assert.ok(content.includes("listSchedules:"), "Deve conter listSchedules");
    assert.ok(content.includes("createSchedule:"), "Deve conter createSchedule");
    assert.ok(content.includes("pauseSchedule:"), "Deve conter pauseSchedule");
    assert.ok(content.includes("resumeSchedule:"), "Deve conter resumeSchedule");
    assert.ok(content.includes("triggerSchedule:"), "Deve conter triggerSchedule");
    assert.ok(content.includes("deleteSchedule:"), "Deve conter deleteSchedule");
  });

  test("T-1.4: ScheduleModal.tsx deve existir com presets de Cron, concorrência e webhooks", () => {
    const modalFile = path.resolve(__dirname, "../src/features/designer/scheduler/ScheduleModal.tsx");
    assert.ok(fs.existsSync(modalFile), "ScheduleModal.tsx deve existir");

    const content = fs.readFileSync(modalFile, "utf-8");
    assert.ok(content.includes("CRON_PRESETS"), "Deve conter presets de Cron");
    assert.ok(content.includes("SKIP_IF_RUNNING"), "Deve suportar SKIP_IF_RUNNING");
    assert.ok(content.includes("ALLOW"), "Deve suportar ALLOW");
    assert.ok(content.includes("QUEUE"), "Deve suportar QUEUE");
    assert.ok(content.includes("webhookUrl"), "Deve conter campo de webhookUrl");
    assert.ok(content.includes("notifySuccess"), "Deve conter opção de notificar sucesso");
    assert.ok(content.includes("notifyFailure"), "Deve conter opção de notificar falha");
  });

  test("T-1.4: Canvas.tsx deve renderizar o botão de acesso rápido e integrar o ScheduleModal", () => {
    const canvasFile = path.resolve(__dirname, "../src/features/designer/Canvas.tsx");
    const content = fs.readFileSync(canvasFile, "utf-8");

    assert.ok(content.includes("btn-open-schedules"), "Canvas deve conter botão btn-open-schedules");
    assert.ok(content.includes("<ScheduleModal"), "Canvas deve integrar o componente ScheduleModal");
    assert.ok(content.includes("isScheduleModalOpen"), "Canvas deve gerenciar o estado isScheduleModalOpen");
  });
});
