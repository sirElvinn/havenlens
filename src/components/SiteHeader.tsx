import HavenMark from "./HavenMark";
export default function SiteHeader({active}:{active:"dossiers"|"method"|"field"|"building"}) {
  return <header className="orbitHead">
    <a className="orbitBrand" href="/"><HavenMark/>HavenLens</a>
    <nav aria-label="Main navigation"><a href="/" aria-current={active==="dossiers"?"page":undefined}>Buildings</a><a href="/method" aria-current={active==="method"?"page":undefined}>How we know</a></nav>
  </header>
}
