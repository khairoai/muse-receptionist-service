import { DemoPage } from "@/components/demo-page";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

// khairo.ai/demo, on this repo's receptionist: the site's top bar, the demo page and its footer.
export default function Page() {
  return (
    <div className="landing-theme overflow-x-clip">
      <SiteNav />
      <div className="site-container">
        <main>
          <DemoPage eyebrow="AI receptionist live demo" />
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
