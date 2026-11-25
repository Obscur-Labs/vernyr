import { Nav } from '@/components/Nav';
import { Hero } from '@/components/Hero';
import { About } from '@/components/About';
import { Services } from '@/components/Services';
import { Partners } from '@/components/Partners';
import { Voices } from '@/components/Voices';
import { Contact } from '@/components/Contact';
import { Footer } from '@/components/Footer';

export default function Page() {
  return (
    <>
      <a
        href="#about"
        className="sr-only focus:not-sr-only focus:fixed focus:left-6 focus:top-6 focus:z-[60] focus:rounded-full focus:bg-ink focus:px-5 focus:py-3 focus:text-[14px] focus:text-paper"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <About />
        <Services />
        <Partners />
        <Voices />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
