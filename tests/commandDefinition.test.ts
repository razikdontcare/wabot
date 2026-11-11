import { describe, expect, it } from "bun:test";
import {
  createCustomCommandSchema,
  updateBuiltinCommandSchema,
  updateCustomCommandSchema,
} from "../src/domain/models/CommandDefinition.js";

const valid = {
  name: "halo",
  aliases: ["hi"],
  description: "Sapaan",
  response: "Halo {{args}}",
};

describe("createCustomCommandSchema", () => {
  it("accepts a minimal valid command", () => {
    expect(createCustomCommandSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["name with spaces", { ...valid, name: "ha lo" }],
    ["name with symbols", { ...valid, name: "ha!lo" }],
    ["dash-prefixed name", { ...valid, name: "-halo" }],
    ["empty response", { ...valid, response: "" }],
    ["oversized response", { ...valid, response: "x".repeat(4097) }],
    ["too many aliases", { ...valid, aliases: ["a", "b", "c", "d", "e", "f"] }],
    ["unknown category", { ...valid, category: "admin" }],
  ])("rejects %s", (_label, input) => {
    expect(createCustomCommandSchema.safeParse(input).success).toBe(false);
  });

  it("normalizes names and aliases to lowercase", () => {
    const parsed = createCustomCommandSchema.parse({
      ...valid,
      name: "Halo",
      aliases: ["HI"],
    });

    expect(parsed.name).toBe("halo");
    expect(parsed.aliases).toEqual(["hi"]);
  });
});

describe("update schemas", () => {
  it("allow partial updates and keep names immutable", () => {
    expect(updateCustomCommandSchema.safeParse({ enabled: false }).success).toBe(
      true,
    );
    expect(updateCustomCommandSchema.safeParse({ name: "other" }).success).toBe(
      false,
    );
    expect(
      updateBuiltinCommandSchema.safeParse({
        enabled: false,
        disabledReason: "rusak",
      }).success,
    ).toBe(true);
  });

  it("does not apply create-schema defaults to a partial update", () => {
    expect(updateCustomCommandSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    });

    const parsed = updateCustomCommandSchema.parse({ description: "Baru" });
    expect(parsed).toEqual({ description: "Baru" });
    expect("enabled" in parsed).toBe(false);
    expect("category" in parsed).toBe(false);
    expect("aliases" in parsed).toBe(false);
  });

  it("rejects unknown keys on create and update", () => {
    expect(
      createCustomCommandSchema.safeParse({ ...valid, bogus: true }).success,
    ).toBe(false);
    expect(
      updateCustomCommandSchema.safeParse({ enabled: false, bogus: true })
        .success,
    ).toBe(false);
  });
});
