<template>
  <div class="container">
    <div class="editor-panel">
      <h2>Component Editor</h2>
      <textarea ref="editorElement"></textarea>
      <button @click="compileComponent" class="compile-btn">
        Compile Component
      </button>
    </div>

    <div class="right-panel">
      <div class="props-panel">
        <h2>Props Schema</h2>
        <div class="props-schema">
          <!-- Displays extracted props as JSON schema -->
          <pre v-if="!propsSchema" class="empty-state">
Compile a component to see props schema</pre
          >
          <pre v-else>{{ JSON.stringify(propsSchema, null, 2) }}</pre>
        </div>

        <!-- Displays extracted props as input fields -->
        <div v-if="propsSchema?.properties" class="props-inputs">
          <h3>Props Values</h3>
          <div
            v-for="(propDef, propName) in propsSchema.properties"
            :key="propName"
            class="prop-input"
          >
            <label>{{ propName }}</label>
            <input
              v-if="propDef.type === 'string'"
              v-model="propValues[propName]"
              type="text"
              :placeholder="propDef.default"
            />
            <input
              v-else-if="propDef.type === 'number'"
              v-model.number="propValues[propName]"
              type="number"
              :placeholder="propDef.default"
              :min="propDef.minimum"
              :max="propDef.maximum"
            />
          </div>
        </div>
      </div>

      <div class="preview-panel">
        <h2>Component Preview</h2>
        <div ref="componentMount" class="component-mount">
          <!-- Compiled component mounts here -->
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, watch, computed, onUnmounted } from "vue";
import CodeMirror from "codemirror";
import "codemirror/lib/codemirror.css";
import "codemirror/mode/vue/vue.js";
import { WebContainer } from "@webcontainer/api";
import { createApp } from "vue";

// Store WebContainer instance at module level to persist across component re-renders
let globalWebContainerInstance = null;
let webContainerInitPromise = null;
let webContainerInitError = null; // Store persistent error to prevent retries

export default {
  name: "App",
  setup() {
    const editorElement = ref(null);
    const componentMount = ref(null);
    const propsSchema = ref(null);
    const propValues = ref({});

    let editor = null;
    let mountedApp = null;

    // Sample component to start with
    const sampleComponent = `<template>
  <div class="metric-card">
    <h3>{{ title }}</h3>
    <p>Count: {{ count }}</p>
    <button @click="increment">+1</button>
  </div>
</template>

<script>
export default {
  props: {
    title: {
      type: String,
      default: 'My Counter',
      mvt: {
        type: 'text',
        description: 'Counter title'
      }
    },
    startValue: {
      type: Number,
      default: 0,
      mvt: {
        type: 'number',
        description: 'Starting value',
        min: 0,
        max: 100
      }
    }
  },
  data() {
    return {
      count: this.startValue
    }
  },
  methods: {
    async increment() {
      this.count++
      await $mvt.store.setItem('count', this.count)
    }
  }
}
<\/script>`;

    onMounted(() => {
      // Initialize CodeMirror
      editor = CodeMirror.fromTextArea(editorElement.value, {
        mode: "vue",
        theme: "default",
        lineNumbers: true,
      });

      editor.setValue(sampleComponent);
    });

    // Store the last compiled component for prop updates
    let lastCompiledComponent = null;

    // Watch propValues and update component props when they change (after initial mount)
    watch(
      propValues,
      async (newValues) => {
        // Only update if component is already mounted and we have a compiled component
        if (propsSchema.value && mountedApp && componentMount.value && lastCompiledComponent) {
          try {
            // Unmount and remount with new props
            mountedApp.unmount();
            mountedApp = null;
            componentMount.value.innerHTML = "";
            
            // Reuse the last compiled component definition
            const Component = lastCompiledComponent;
            mountedApp = createApp(Component, newValues);
            mountedApp.mount(componentMount.value);
          } catch (error) {
            console.error("Error updating component props:", error);
          }
        }
      },
      { deep: true }
    );

    // Initialize WebContainer
    async function initWebContainer() {
      // If already initialized, return the existing instance
      if (globalWebContainerInstance) {
        console.log("Using existing WebContainer instance");
        return globalWebContainerInstance;
      }
      
      // If we have a persistent error (like "already initialized"), don't retry
      if (webContainerInitError) {
        console.warn("WebContainer initialization previously failed, not retrying");
        throw webContainerInitError;
      }
      
      // If initialization is in progress, wait for it
      if (webContainerInitPromise) {
        console.log("WebContainer initialization in progress, waiting...");
        try {
          return await webContainerInitPromise;
        } catch (error) {
          // If the promise was rejected, don't retry
          webContainerInitError = error;
          throw error;
        }
      }
      
      // Start initialization
      console.log("Initializing WebContainer...");
      webContainerInitPromise = (async () => {
        try {
          // Check if WebContainer is already booted globally
          // WebContainer.boot() can only be called once per page
          try {
            globalWebContainerInstance = await WebContainer.boot();
            console.log("WebContainer booted successfully");
          } catch (bootError) {
            // Check if it's the "already initialized" error
            if (bootError.message && (
              bootError.message.includes("Only a single WebContainer instance") ||
              bootError.message.includes("already initialized") ||
              bootError.message.includes("already booted")
            )) {
              console.warn("WebContainer already booted");
              
              // If we already have the instance stored, use it
              if (globalWebContainerInstance) {
                console.log("Reusing existing WebContainer instance");
                return globalWebContainerInstance;
              }
              
              // WebContainer API doesn't allow accessing an already-booted instance
              // This typically happens during HMR - store error to prevent retries
              const error = new Error("WebContainer is already initialized (likely due to hot module reload). Please refresh the page (F5 or Ctrl+R) to reset.");
              webContainerInitError = error;
              throw error;
            } else {
              // Re-throw non-initialization errors
              throw bootError;
            }
          }
          
          // Create package.json for the container
          // IMPORTANT: "type": "module" makes all .js files ES modules
          const packageJson = {
            name: "vue-compiler",
            type: "module",
            version: "1.0.0",
            dependencies: {
              "@vue/compiler-sfc": "^3.4.0",
            },
          };
          
          await globalWebContainerInstance.fs.writeFile(
            "/package.json",
            JSON.stringify(packageJson, null, 2)
          );
          
          // Verify package.json was written
          const verifyPkg = await globalWebContainerInstance.fs.readFile("/package.json", "utf-8");
          console.log("package.json created:", verifyPkg.substring(0, 100));
          
          // Install dependencies
          console.log("Installing dependencies...");
          const installProcess = await globalWebContainerInstance.spawn("npm", ["install"]);
          
          const installOutput = [];
          installProcess.output.pipeTo(
            new WritableStream({
              write(data) {
                installOutput.push(data);
              },
            })
          );
          
          const exitCode = await installProcess.exit;
          const outputText = installOutput.join("");
          
          if (exitCode !== 0) {
            console.error("npm install failed. Exit code:", exitCode);
            console.error("Output:", outputText);
            throw new Error(`Failed to install dependencies: ${outputText}`);
          }
          
          console.log("Dependencies installed successfully");
          
          // Verify node_modules exists
          try {
            const nodeModules = await globalWebContainerInstance.fs.readdir("/", { withFileTypes: true });
            const hasNodeModules = nodeModules.some(item => item.name === "node_modules");
            if (!hasNodeModules) {
              console.warn("node_modules directory not found after installation");
            } else {
              console.log("node_modules directory verified");
            }
          } catch (e) {
            console.warn("Could not verify node_modules:", e);
          }
          
          console.log("WebContainer initialized");
          return globalWebContainerInstance;
        } catch (error) {
          // Store persistent errors to prevent retries
          if (error.message && (
            error.message.includes("already initialized") ||
            error.message.includes("Only a single WebContainer instance")
          )) {
            webContainerInitError = error;
          }
          // Don't reset promise to null - keep it so subsequent calls get the same error
          throw error;
        }
      })();
      
      try {
        const instance = await webContainerInitPromise;
        
        // Ensure instance is valid
        if (!instance) {
          throw new Error("Failed to initialize WebContainer");
        }
        
        return instance;
      } catch (error) {
        // If initialization failed, store error but don't reset promise
        // so subsequent calls get the same error
        throw error;
      }
    }

    // Compile Vue SFC using WebContainer
    async function compileVueSFC(source) {
      const container = await initWebContainer();
      
      // Write files to root directory (absolute paths are more reliable in WebContainer)
      const componentPath = "/component.vue";
      const compileScriptPath = "/compile.mjs"; // Use .mjs extension to explicitly mark as ES module
      
      // Write the Vue component to a file
      await container.fs.writeFile(componentPath, source);
      console.log("Component file written to:", componentPath);
      
      // Small delay to ensure file system sync
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Verify the file was written successfully
      try {
        const verifyContent = await container.fs.readFile(componentPath, "utf-8");
        if (verifyContent !== source) {
          console.warn("File content mismatch, but continuing...");
        } else {
          console.log("Component file verified");
        }
      } catch (verifyError) {
        console.warn("Could not verify file, but continuing:", verifyError.message);
      }

      // Create a compilation script that outputs the compiled component as JSON
      const compileScript = `import { readFileSync, readdirSync } from 'fs';
import { compileTemplate, compileScript, parse } from '@vue/compiler-sfc';

try {
  // Try multiple possible file paths
  let componentSource;
  const pathsToTry = [
    './component.vue',
    '/component.vue'
  ];
  
  let lastError;
  for (const filePath of pathsToTry) {
    try {
      componentSource = readFileSync(filePath, 'utf-8');
      // Debug message goes to stderr only
      process.stderr.write(\`Successfully read component from: \${filePath}\\n\`);
      break;
    } catch (e) {
      lastError = e;
      continue;
    }
  }
  
  if (!componentSource) {
    // List files for debugging (stderr only)
    try {
      const rootFiles = readdirSync('/');
      process.stderr.write(\`Files in root: \${rootFiles.join(', ')}\\n\`);
    } catch (e) {
      // Ignore
    }
    throw new Error(\`Could not find component.vue. Last error: \${lastError?.message || 'unknown'}\`);
  }
  
  const { descriptor } = parse(componentSource);

  // Compile script
  const scriptResult = compileScript(descriptor, {
    id: 'component'
  });

  // Compile template
  const templateResult = compileTemplate({
    source: descriptor.template.content,
    id: 'component',
    compilerOptions: {
      mode: 'module'
    }
  });

  // Create a browser-executable component definition
  const scriptCode = scriptResult.content.replace(/export default/g, 'const __sfc__ =');
  const renderCode = templateResult.code.replace(/export function render/, 'function render');
  
  const output = {
    script: scriptCode,
    render: renderCode,
    hasSetup: descriptor.scriptSetup !== null,
    template: descriptor.template?.content || ''
  };

  // Output JSON to stdout
  process.stdout.write(JSON.stringify(output));
} catch (error) {
  console.error('Compilation error:', error.message);
  process.exit(1);
}`;

      await container.fs.writeFile(compileScriptPath, compileScript);
      console.log("Compilation script written to:", compileScriptPath);
      
      // Verify package.json has type: module
      try {
        const pkgContent = await container.fs.readFile("/package.json", "utf-8");
        const pkg = JSON.parse(pkgContent);
        if (pkg.type !== "module") {
          console.warn("Warning: package.json type is not 'module'");
        } else {
          console.log("Confirmed: package.json has type: 'module'");
        }
      } catch (e) {
        console.warn("Could not verify package.json:", e);
      }
      
      // Small delay to ensure file system sync
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify compile script was written and readable
      try {
        const verifyScript = await container.fs.readFile(compileScriptPath, "utf-8");
        if (verifyScript.length === 0) {
          throw new Error("Compile script is empty");
        }
        console.log("Compile script verified, length:", verifyScript.length);
      } catch (e) {
        console.error("Failed to verify compile script:", e);
        throw new Error(`Failed to write compile script: ${e.message}`);
      }

      // Verify file exists in filesystem
      try {
        const filesInRoot = await container.fs.readdir("/");
        console.log("Files in root before spawn:", filesInRoot);
        
        if (!filesInRoot.includes("compile.mjs")) {
          console.error("compile.mjs not found in root directory listing");
          throw new Error("compile.mjs file not found in filesystem");
        }
      } catch (dirError) {
        console.warn("Could not list files, but continuing:", dirError.message);
      }
      
      // Run the compilation process
      // Use .mjs extension which explicitly marks the file as an ES module
      // This works regardless of package.json type setting
      console.log("Spawning node process...");
      const compileProcess = await container.spawn("node", ["compile.mjs"]);
      console.log("Compilation process spawned successfully");
      
      let compiledOutput = "";
      let errorOutput = "";
      
      // Capture stdout
      compileProcess.output.pipeTo(
        new WritableStream({
          write(data) {
            compiledOutput += data;
          },
        })
      );
      
      // Capture stderr
      if (compileProcess.outputStderr) {
        compileProcess.outputStderr.pipeTo(
          new WritableStream({
            write(data) {
              errorOutput += data;
            },
          })
        );
      }

      const exitCode = await compileProcess.exit;
      
      if (exitCode !== 0) {
        const errorMessage = errorOutput || compiledOutput || "Unknown compilation error";
        throw new Error(`Compilation failed: ${errorMessage}`);
      }
      
      // If we got error output but exit code is 0, log it for debugging
      if (errorOutput) {
        console.warn("Compilation warnings:", errorOutput);
      }

      // Parse the JSON output - filter out any non-JSON lines (debug messages)
      // Find the JSON line (starts with {)
      const lines = compiledOutput.split('\n');
      let jsonLine = '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          jsonLine = trimmed;
          break;
        }
      }
      
      if (!jsonLine) {
        // If no JSON found, try parsing the whole output
        // Remove any lines that don't look like JSON
        const cleanedOutput = lines
          .filter(line => {
            const trimmed = line.trim();
            return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed === '';
          })
          .join('\n')
          .trim();
        
        if (!cleanedOutput) {
          throw new Error(`No valid JSON output found. Output: ${compiledOutput.substring(0, 200)}`);
        }
        jsonLine = cleanedOutput;
      }
      
      const compiledData = JSON.parse(jsonLine);
      
      // Combine script and render into executable component code
      return {
        script: compiledData.script,
        render: compiledData.render,
        hasSetup: compiledData.hasSetup,
      };
    }

    // Mount the compiled component
    async function mountComponent(newPropValues = null) {
      if (!componentMount.value) return;

      // Clear previous mount
      if (mountedApp) {
        mountedApp.unmount();
        mountedApp = null;
        componentMount.value.innerHTML = "";
      }

      try {
        // Get the compiled code from the component
        const source = editor.getValue();
        const compiled = await compileVueSFC(source);

        // Import Vue runtime helpers that the compiled code needs
        const { 
          createElementVNode, 
          toDisplayString,
          createTextVNode,
          openBlock,
          createElementBlock,
          Fragment,
          createCommentVNode,
          renderList,
          normalizeClass,
          normalizeStyle,
          withDirectives,
          vModelText,
          vModelCheckbox,
          vModelRadio,
          vShow,
          createVNode,
          createBlock,
          withCtx,
          resolveComponent,
        } = await import('vue');

        // Execute the script code in a context that provides Vue APIs
        // The compiled script expects __sfc__ to be defined
        // Vue compiled render functions use underscore-prefixed helper names
        const vueImports = {
          defineComponent: (options) => options,
          ref,
          computed,
          watch,
          onMounted,
          onUnmounted,
          // Add runtime helpers with underscore prefixes (as used by compiled code)
          _createElementVNode: createElementVNode,
          _toDisplayString: toDisplayString,
          _createTextVNode: createTextVNode,
          _openBlock: openBlock,
          _createElementBlock: createElementBlock,
          _Fragment: Fragment,
          _createCommentVNode: createCommentVNode,
          _renderList: renderList,
          _normalizeClass: normalizeClass,
          _normalizeStyle: normalizeStyle,
          _withDirectives: withDirectives,
          _vModelText: vModelText,
          _vModelCheckbox: vModelCheckbox,
          _vModelRadio: vModelRadio,
          _vShow: vShow,
          _createVNode: createVNode,
          _createBlock: createBlock,
          _withCtx: withCtx,
          _resolveComponent: resolveComponent,
          // Also provide non-underscore versions for flexibility
          createElementVNode,
          toDisplayString,
          createTextVNode,
          openBlock,
          createElementBlock,
          Fragment,
          createCommentVNode,
          renderList,
          normalizeClass,
          normalizeStyle,
          withDirectives,
          vModelText,
          vModelCheckbox,
          vModelRadio,
          vShow,
          createVNode,
          createBlock,
          withCtx,
          resolveComponent,
        };

        // Create a context for executing the compiled script
        // Strip ALL import statements
        let scriptCode = compiled.script
          .replace(/import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];?/g, "")
          .replace(/import\s+\*\s+as\s+\w+\s+from\s+['"][^'"]+['"];?/g, "")
          .replace(/import\s+\w+\s+from\s+['"][^'"]+['"];?/g, "")
          .replace(/export\s+default/g, "const __sfc__ =");

        let renderCode = compiled.render
          .replace(/import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];?/g, "")
          .replace(/export\s+function\s+render/, "function render");

        // Execute the script code to get the component definition
        let Component;
        try {
          // Use Function constructor to execute the script
          // This creates __sfc__ which contains our component options
          const executeScript = new Function(
            ...Object.keys(vueImports),
            `
            ${scriptCode}
            return typeof __sfc__ !== 'undefined' ? __sfc__ : {};
          `
          );

          const componentOptions = executeScript(...Object.values(vueImports));

          // Execute the render function with all Vue helpers available
          const executeRender = new Function(
            ...Object.keys(vueImports),
            "_ctx", "_cache", "$props", "$setup", "$data", "$options",
            `
            ${renderCode}
            return render;
          `
          );

          const renderFunction = executeRender(...Object.values(vueImports), {}, {}, {}, {}, {}, {});

          // Combine component options with render function
          Component = {
            ...componentOptions,
            render: renderFunction,
          };
        } catch (scriptError) {
          // If the compiled code uses setup syntax or different structure, try alternative
          console.warn("First compilation attempt failed, trying alternative:", scriptError);
          console.error("Script error details:", scriptError);
          
          // Log the problematic code for debugging
          console.log("Script code:", scriptCode.substring(0, 500));
          console.log("Render code:", renderCode.substring(0, 500));
          
          throw scriptError;
        }

        // Store the compiled component for prop updates
        lastCompiledComponent = Component;

        // Create props object from current propValues
        const propsToPass = newPropValues || propValues.value;

        // Create and mount the app
        mountedApp = createApp(Component, propsToPass);
        mountedApp.mount(componentMount.value);
      } catch (error) {
        console.error("Error mounting component:", error);
        if (componentMount.value) {
          componentMount.value.innerHTML = `<pre style="color: red; padding: 10px;">Error mounting component:\n${error.message}\n\nStack:\n${error.stack}</pre>`;
        }
        throw error;
      }
    }

    // Initialize WebContainer and compile Vue SFC
    async function compileComponentHandler() {
      try {
      const source = editor.getValue();
      console.log("Compiling component:", source);

        // Extract props first
        propsSchema.value = extractProps(source);
        
        // Initialize default prop values
        if (propsSchema.value?.properties) {
          const newPropValues = {};
          for (const [propName, propDef] of Object.entries(
            propsSchema.value.properties
          )) {
            if (propDef.default !== undefined) {
              newPropValues[propName] = propDef.default;
            } else if (propDef.type === "string") {
              newPropValues[propName] = "";
            } else if (propDef.type === "number") {
              newPropValues[propName] = 0;
            } else if (propDef.type === "boolean") {
              newPropValues[propName] = false;
            }
          }
          propValues.value = newPropValues;
        }

        // Compile and mount the component
        await mountComponent(propValues.value);
      } catch (error) {
        console.error("Error compiling component:", error);
        if (componentMount.value) {
          componentMount.value.innerHTML = `<pre style="color: red;">Error: ${error.message}</pre>`;
        }
      }
    }

    // Extract props from Vue component and convert to JSON Schema
    function extractProps(componentSource) {
      try {
        // Extract the script section
        const scriptMatch = componentSource.match(
          /<script[^>]*>([\s\S]*?)<\/script>/
        );
        if (!scriptMatch) {
      return null;
        }

        const scriptContent = scriptMatch[1];

        // Extract the props object - look for props: { ... }
        // Need to match nested braces correctly
        const propsStart = scriptContent.indexOf('props:');
        if (propsStart === -1) {
          return {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            properties: {},
          };
        }

        // Find the opening brace after 'props:'
        const afterProps = scriptContent.substring(propsStart + 6);
        const firstBrace = afterProps.indexOf('{');
        if (firstBrace === -1) {
          return {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            properties: {},
          };
        }

        // Extract content between matching braces
        let braceCount = 0;
        let propsEndIndex = -1;
        const startIndex = propsStart + 6 + firstBrace + 1;
        
        for (let i = propsStart + 6 + firstBrace; i < scriptContent.length; i++) {
          if (scriptContent[i] === '{') {
            braceCount++;
          } else if (scriptContent[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              propsEndIndex = i;
              break;
            }
          }
        }

        if (propsEndIndex === -1) {
          return {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            properties: {},
          };
        }

        const propsString = scriptContent.substring(startIndex, propsEndIndex);
        const properties = {};

        // Extract individual prop definitions using a more robust approach
        // Split by property names (identifiers followed by colon)
        const propRegex = /(\w+):\s*\{/g;
        let propMatch;

        const matches = [];
        while ((propMatch = propRegex.exec(propsString)) !== null) {
          matches.push({
            name: propMatch[1],
            startIndex: propMatch.index + propMatch[0].length - 1
          });
        }

        // Extract each prop definition by finding matching braces
        for (let i = 0; i < matches.length; i++) {
          const propName = matches[i].name;
          let braceCount = 0;
          let propDefEnd = -1;
          
          for (let j = matches[i].startIndex; j < propsString.length; j++) {
            if (propsString[j] === '{') {
              braceCount++;
            } else if (propsString[j] === '}') {
              braceCount--;
              if (braceCount === 0) {
                propDefEnd = j;
                break;
              }
            }
          }

          if (propDefEnd === -1) continue;

          const propDef = propsString.substring(matches[i].startIndex + 1, propDefEnd);
          const propSchema = {};

          // Extract type
          const typeMatch = propDef.match(/type:\s*(\w+)/);
          if (typeMatch) {
            const vueType = typeMatch[1];
            // Convert Vue types to JSON Schema types
            if (vueType === "String") {
              propSchema.type = "string";
            } else if (vueType === "Number") {
              propSchema.type = "number";
            } else if (vueType === "Boolean") {
              propSchema.type = "boolean";
            } else if (vueType === "Array") {
              propSchema.type = "array";
            } else if (vueType === "Object") {
              propSchema.type = "object";
            }
          }

          // Extract default value
          const defaultMatch = propDef.match(/default:\s*([^,\n}]+)/);
          if (defaultMatch) {
            const defaultStr = defaultMatch[1].trim();
            try {
              // Try to parse the default value
              if (propSchema.type === "string") {
                // Remove quotes and handle escaped characters
                propSchema.default = defaultStr
                  .replace(/^['"]|['"]$/g, "")
                  .replace(/\\(.)/g, "$1");
              } else if (propSchema.type === "number") {
                propSchema.default = Number(defaultStr);
              } else if (propSchema.type === "boolean") {
                propSchema.default = defaultStr === "true";
              } else {
                // Try JSON parse for other types
                propSchema.default = JSON.parse(defaultStr);
              }
            } catch (e) {
              // If parsing fails, keep as string or use the raw value
              if (propSchema.type === "string") {
                propSchema.default = defaultStr.replace(/^['"]|['"]$/g, "");
              }
            }
          }

          // Extract mvt metadata
          const mvtMatch = propDef.match(/mvt:\s*\{([\s\S]*?)\}(?=\s*[,}])/);
          if (mvtMatch) {
            const mvtContent = mvtMatch[1];

            // Extract description
            const descMatch = mvtContent.match(/description:\s*['"]([^'"]+)['"]/);
            if (descMatch) {
              propSchema.description = descMatch[1];
            }

            // Extract min/max for numbers
            if (propSchema.type === "number") {
              const minMatch = mvtContent.match(/min:\s*(\d+)/);
              const maxMatch = mvtContent.match(/max:\s*(\d+)/);
              if (minMatch) {
                propSchema.minimum = Number(minMatch[1]);
              }
              if (maxMatch) {
                propSchema.maximum = Number(maxMatch[1]);
              }
            }
          }

          properties[propName] = propSchema;
        }

        return {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties,
        };
      } catch (error) {
        console.error("Error extracting props:", error);
        return null;
      }
    }

    return {
      editorElement,
      componentMount,
      propsSchema,
      propValues,
      compileComponent: compileComponentHandler,
    };
  },
};
</script>
