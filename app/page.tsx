import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { Marquee } from "@/components/Marquee";
import { About } from "@/components/About";
import { Services } from "@/components/Services";
import { Work } from "@/components/Work";
import { Process } from "@/components/Process";
import { Why } from "@/components/Why";
import { Testimonials } from "@/components/Testimonials";
import { Contact } from "@/components/Contact";
import { Footer } from "@/components/Footer";
import { Cursor } from "@/components/Cursor";

export default function HomePage() {
  return (
    <>
      <Header />
      <main id="main">
        <Hero />
        <Marquee />
        <About />
        <Services />
        <Work />
        <Process />
        <Why />
        <Testimonials />
        <Contact />
      </main>
      <Footer />
      <Cursor />
    </>
  );
}
