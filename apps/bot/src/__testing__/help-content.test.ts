import { describe, expect, it } from "vitest";

import {
  buildGlossaryEmbed,
  buildHelpEmbed,
  glossaryTermChoices,
  helpTopicChoices,
} from "../help-content";

describe("help content", () => {
  it("renders default help with neutral RepBet copy", () => {
    const data = buildHelpEmbed(null, false).toJSON();

    expect(data.title).toBe("RepBet help");
    expect(data.description).toContain("RepBet lets this server create markets");
    expect(data.description).toContain("/market buy");
    expect(data.description).not.toMatch(/habit/iu);
  });

  it("renders specific market buy help", () => {
    const data = buildHelpEmbed("market buy", false).toJSON();

    expect(data.title).toBe("/market buy");
    expect(data.description).toContain("Buy YES or NO contracts");
    expect(data.description).toContain("prices can move");
  });

  it("keeps playful examples in market overview only", () => {
    const data = buildHelpEmbed("market", false).toJSON();

    expect(data.description).toContain("Will Mark make it to game night before 8pm?");
    expect(data.description).toContain("Will Logan finish Elden Ring before June?");
    expect(data.description).toContain("Will Grayson touch grass this weekend?");
    expect(data.description).not.toContain("Will Taylor uninstall League");
    expect(data.description).not.toContain("Will brunch plans survive the group chat?");
  });

  it("renders recurring market examples", () => {
    const data = buildHelpEmbed("market recurring", false).toJSON();

    expect(data.description).toContain("Will Grayson go to the gym today?");
    expect(data.description).toContain("Will Mark finish a ranked match before midnight?");
    expect(data.description).toContain("Will Logan make market open today?");
  });

  it("hides admin topics from non-admin autocomplete", () => {
    expect(helpTopicChoices("admin", false)).toEqual([]);
    expect(helpTopicChoices("admin", true).map((choice) => choice.value)).toContain("admin");
  });

  it("renders glossary overview and term detail", () => {
    const overview = buildGlossaryEmbed(null).toJSON();
    const rep = buildGlossaryEmbed("rep").toJSON();

    expect(overview.title).toBe("Glossary");
    expect(overview.description).toContain("**REP**");
    expect(rep.title).toBe("REP");
    expect(rep.description).toContain("unit used for balances");
  });

  it("autocompletes glossary aliases", () => {
    expect(glossaryTermChoices("target_shares").map((choice) => choice.value)).toEqual([
      "target shares",
    ]);
  });
});
