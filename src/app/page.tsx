import SearchBar from "@/components/SearchBar";
import Reveal from "@/components/Reveal";

export default function Home() {
  return (
    <div className="text-center py-10 sm:py-16">
      <Reveal>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight">
          Any phone. <span className="gradient-text">Live data.</span>
        </h1>
      </Reveal>
      <Reveal delay={100}>
        <p className="mt-4 text-slate-400 max-w-xl mx-auto leading-relaxed">
          Search any smartphone — current or future. The system discovers devices from
          public APIs, open datasets and robots-compliant web research, then shows every
          field with its source and confidence level.
        </p>
      </Reveal>
      <div className="mt-10">
        <SearchBar />
      </div>
      <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto text-left">
        {[
          ["🔎 Multi-source pipeline", "Providers are queried in priority order; if one lacks the phone, the next is tried automatically."],
          ["🔗 Source attribution", "Every spec carries its source, link, retrieval date and confidence badge."],
          ["🚫 No fake data, ever", "Missing values render as “Not available”. Estimates and AI analysis are clearly labeled."],
        ].map(([t, d], i) => (
          <Reveal key={t} delay={150 + i * 120}>
            <div className="card card-hover p-5 h-full">
              <div className="font-semibold mb-1">{t}</div>
              <p className="text-sm text-slate-400 leading-relaxed">{d}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
