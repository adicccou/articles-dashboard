import type { ReactNode } from "react";
import type { StudioAppProfile } from "../lib/studioAppProfile";
import { joinStudioAppProfileList, splitStudioAppProfileList } from "../lib/studioAppProfile";

type StudioAppProfileEditorProps = {
  profile: StudioAppProfile;
  onChange: (profile: StudioAppProfile) => void;
};

type ProfileTextKey =
  | "category"
  | "target_users"
  | "skill_level"
  | "not_for"
  | "problem_before"
  | "positioning_statement"
  | "main_promise"
  | "main_differentiation"
  | "brand_tone"
  | "reply_style"
  | "pricing_summary"
  | "main_cta"
  | "offer_details"
  | "agent_instructions";

type ProfileListKey =
  | "current_alternatives"
  | "frustrations"
  | "competitors"
  | "top_features"
  | "feature_benefits"
  | "screens_to_show"
  | "proof_points"
  | "example_cases"
  | "words_to_use"
  | "words_to_avoid"
  | "forbidden_claims"
  | "best_platforms"
  | "content_angles"
  | "target_posts"
  | "reject_signals";

function FieldSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="config-form-section">
      <div className="config-form-section__header">
        <h3>{title}</h3>
      </div>
      <div className="config-form-section__body">{children}</div>
    </section>
  );
}

function ListField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
}) {
  return (
    <label>
      {label}
      <textarea
        rows={4}
        value={joinStudioAppProfileList(value)}
        placeholder={placeholder}
        onChange={(event) => onChange(splitStudioAppProfileList(event.target.value))}
      />
      <small className="config-hint">One item per line.</small>
    </label>
  );
}

export function StudioAppProfileEditor({ profile, onChange }: StudioAppProfileEditorProps) {
  function updateTextField(key: ProfileTextKey, value: string) {
    onChange({ ...profile, [key]: value });
  }

  function updateListField(key: ProfileListKey, value: string[]) {
    onChange({ ...profile, [key]: value });
  }

  return (
    <>
      <FieldSection title="Basic identity">
        <div className="grid-two">
          <label>
            Category
            <input
              value={profile.category}
              placeholder="Trading journal, CRM, design tool, habit app"
              onChange={(event) => updateTextField("category", event.target.value)}
            />
          </label>
          <label>
            Skill level
            <input
              value={profile.skill_level}
              placeholder="Beginner, pro, teams, solo founders, traders"
              onChange={(event) => updateTextField("skill_level", event.target.value)}
            />
          </label>
        </div>
      </FieldSection>

      <FieldSection title="Who it is for">
        <div className="grid-two">
          <label>
            Target users
            <textarea
              rows={3}
              value={profile.target_users}
              placeholder="Who this product is for"
              onChange={(event) => updateTextField("target_users", event.target.value)}
            />
          </label>
          <label>
            Who it is not for
            <textarea
              rows={3}
              value={profile.not_for}
              placeholder="Users the product is not designed for"
              onChange={(event) => updateTextField("not_for", event.target.value)}
            />
          </label>
        </div>
      </FieldSection>

      <FieldSection title="Pain points">
        <label>
          Problem before they find this app
          <textarea
            rows={4}
            value={profile.problem_before}
            placeholder="What is broken or frustrating before they discover the product"
            onChange={(event) => updateTextField("problem_before", event.target.value)}
          />
        </label>
        <div className="grid-two">
          <ListField
            label="What they use instead"
            value={profile.current_alternatives}
            placeholder={"Spreadsheets\nNotion\nCompetitor tools"}
            onChange={(value) => updateListField("current_alternatives", value)}
          />
          <ListField
            label="What frustrates them"
            value={profile.frustrations}
            placeholder={"Too manual\nToo scattered\nToo slow to publish"}
            onChange={(value) => updateListField("frustrations", value)}
          />
        </div>
      </FieldSection>

      <FieldSection title="Positioning">
        <div className="grid-two">
          <label>
            “This is not just X, it is Y”
            <textarea
              rows={3}
              value={profile.positioning_statement}
              placeholder="How to frame the product clearly"
              onChange={(event) => updateTextField("positioning_statement", event.target.value)}
            />
          </label>
          <label>
            Main promise
            <textarea
              rows={3}
              value={profile.main_promise}
              placeholder="Primary promise the product makes"
              onChange={(event) => updateTextField("main_promise", event.target.value)}
            />
          </label>
        </div>
        <div className="grid-two">
          <label>
            Main differentiation
            <textarea
              rows={3}
              value={profile.main_differentiation}
              placeholder="Why this is different from alternatives"
              onChange={(event) => updateTextField("main_differentiation", event.target.value)}
            />
          </label>
          <ListField
            label="Competitors / alternatives"
            value={profile.competitors}
            placeholder={"Buffer\nNotion\nHootsuite"}
            onChange={(value) => updateListField("competitors", value)}
          />
        </div>
      </FieldSection>

      <FieldSection title="Features">
        <div className="grid-two">
          <ListField
            label="Top features"
            value={profile.top_features}
            placeholder={"Calendar scheduling\nReply workflow\nSearch crawler"}
            onChange={(value) => updateListField("top_features", value)}
          />
          <ListField
            label="Feature benefits"
            value={profile.feature_benefits}
            placeholder={"Calendar scheduling keeps the week visible\nReply workflow keeps outreach focused"}
            onChange={(value) => updateListField("feature_benefits", value)}
          />
        </div>
        <ListField
          label="Screens / workflows worth showing in content"
          value={profile.screens_to_show}
          placeholder={"Weekly planner\nSignal review\nReply suggestions"}
          onChange={(value) => updateListField("screens_to_show", value)}
        />
      </FieldSection>

      <FieldSection title="Proof">
        <div className="grid-two">
          <ListField
            label="Proof points"
            value={profile.proof_points}
            placeholder={"100 active users\nFounder uses it daily\nShared screenshots"}
            onChange={(value) => updateListField("proof_points", value)}
          />
          <ListField
            label="Examples / before-after cases"
            value={profile.example_cases}
            placeholder={"From spreadsheets to one dashboard\nBefore: scattered notes, after: planned queue"}
            onChange={(value) => updateListField("example_cases", value)}
          />
        </div>
      </FieldSection>

      <FieldSection title="Voice and rules">
        <div className="grid-two">
          <label>
            Brand tone
            <input
              value={profile.brand_tone}
              placeholder="Direct, playful, premium, technical, founder-led"
              onChange={(event) => updateTextField("brand_tone", event.target.value)}
            />
          </label>
          <label>
            Reply style
            <textarea
              rows={3}
              value={profile.reply_style}
              placeholder="How agents should sound in replies"
              onChange={(event) => updateTextField("reply_style", event.target.value)}
            />
          </label>
        </div>
        <div className="grid-two">
          <ListField
            label="Words to use"
            value={profile.words_to_use}
            placeholder={"clarity\nsignal\nworkflow"}
            onChange={(value) => updateListField("words_to_use", value)}
          />
          <ListField
            label="Words to avoid"
            value={profile.words_to_avoid}
            placeholder={"crush it\ndominate\nhack"}
            onChange={(value) => updateListField("words_to_avoid", value)}
          />
        </div>
        <ListField
          label="Claims we must not make"
          value={profile.forbidden_claims}
          placeholder={"Guaranteed profits\nBest on the market\nOfficial partner unless true"}
          onChange={(value) => updateListField("forbidden_claims", value)}
        />
      </FieldSection>

      <FieldSection title="Social strategy">
        <div className="grid-two">
          <ListField
            label="Best platforms"
            value={profile.best_platforms}
            placeholder={"Twitter/X\nLinkedIn\nReddit"}
            onChange={(value) => updateListField("best_platforms", value)}
          />
          <ListField
            label="Content angles"
            value={profile.content_angles}
            placeholder={"Founder lessons\nPain point breakdowns\nWorkflow demos"}
            onChange={(value) => updateListField("content_angles", value)}
          />
        </div>
        <div className="grid-two">
          <ListField
            label="Posts/comments agents should look for"
            value={profile.target_posts}
            placeholder={"People asking for alternatives\nUsers complaining about manual work"}
            onChange={(value) => updateListField("target_posts", value)}
          />
          <ListField
            label="Low-quality items to reject"
            value={profile.reject_signals}
            placeholder={"Giveaways\nGeneric motivation posts\nBots"}
            onChange={(value) => updateListField("reject_signals", value)}
          />
        </div>
      </FieldSection>

      <FieldSection title="Offer">
        <div className="grid-two">
          <label>
            Free plan / pricing
            <textarea
              rows={3}
              value={profile.pricing_summary}
              placeholder="What the pricing and free plan look like"
              onChange={(event) => updateTextField("pricing_summary", event.target.value)}
            />
          </label>
          <label>
            Main CTA
            <textarea
              rows={3}
              value={profile.main_cta}
              placeholder="Start free, join waitlist, book demo, try it today"
              onChange={(event) => updateTextField("main_cta", event.target.value)}
            />
          </label>
        </div>
        <label>
          Trial / waitlist / discount / lifetime deal
          <textarea
            rows={3}
            value={profile.offer_details}
            placeholder="Any offer mechanics or promo details"
            onChange={(event) => updateTextField("offer_details", event.target.value)}
          />
        </label>
      </FieldSection>

      <FieldSection title="Agent instructions">
        <label>
          Extra agent instructions
          <textarea
            rows={5}
            value={profile.agent_instructions}
            placeholder="Anything Studio agents should always know when researching, drafting, or replying for this app"
            onChange={(event) => updateTextField("agent_instructions", event.target.value)}
          />
        </label>
      </FieldSection>
    </>
  );
}
