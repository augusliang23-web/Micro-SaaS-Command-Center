export class ProjectRegistry {
  #projects;

  constructor(projects = []) {
    this.#projects = new Map(projects.map((project) => [project.project_id, Object.freeze({ ...project })]));
  }

  resolve(projectId) {
    const project = this.#projects.get(projectId);
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    return project;
  }
}
