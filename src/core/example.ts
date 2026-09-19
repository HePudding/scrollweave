import legacy from "../../examples/form.scrollweave.json";
import { migrateProject } from "./migrate";
/** Legacy fixture remains available for migration regression, never the new-work default. */
export const exampleProject = () => migrateProject(legacy);
