import { useState } from "react";
import { slugify } from "../lib/slug";

type SiteFormProps = {
  onCreate: (payload: {
    name: string;
    slug: string;
    domain: string;
    status: "active" | "inactive";
  }) => Promise<void>;
};

export function SiteForm({ onCreate }: SiteFormProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSlug = slug || slugify(name);
    await onCreate({ name, slug: nextSlug, domain, status });
    setName("");
    setSlug("");
    setDomain("");
    setStatus("active");
  }

  return (
    <form className="panel stack" onSubmit={handleSubmit}>
      <div className="panel__title-row">
        <h2>Add Site</h2>
      </div>
      <div className="grid-two">
        <label>
          Name
          <input
            value={name}
            onChange={(e) => {
              const value = e.target.value;
              setName(value);
              setSlug(slugify(value));
            }}
            placeholder="Journl"
            required
          />
        </label>
        <label>
          Slug
          <input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} required />
        </label>
      </div>
      <div className="grid-two">
        <label>
          Domain
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="journl.example.com"
            required
          />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as "active" | "inactive")}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      </div>
      <button type="submit">Create site</button>
    </form>
  );
}
