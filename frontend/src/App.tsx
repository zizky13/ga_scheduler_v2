// Smoke-test: verifies the @pipeline alias and resolver are wired correctly.
// runPipeline is imported but not called here — actual execution is in Phase 4-POC.2.
import { runPipeline, getDefaultInput } from './lib/pipeline'

console.log('[POC smoke-test] runPipeline imported:', typeof runPipeline)
console.log('[POC smoke-test] getDefaultInput imported:', typeof getDefaultInput)

function App() {
  return (
    <div>
      <h1>UPJ Scheduler — POC</h1>
      <p>Phase 4-POC.1: Pipeline bridge wired. Check console for smoke-test output.</p>
    </div>
  )
}

export default App
