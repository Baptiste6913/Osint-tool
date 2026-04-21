// ================================================================
// RUFLO ORCHESTRATOR — Execution d'agents en stages (parallel/sequential)
// Inspire du framework Ruflo (https://github.com/ruvnet/ruflo)
// Utilise les concepts: agents, workflows, stages, strategies
// ================================================================
const { log } = require('../src/helpers');

class RufloOrchestrator {
    constructor(workflow) {
        this.workflow = workflow;
        this.agents = new Map();
        this.results = new Map();
        this.startTime = null;
    }

    registerAgent(name, agentFn) {
        this.agents.set(name, agentFn);
    }

    async executeStage(stage, context) {
        const stageStart = Date.now();
        log(`[Ruflo] Stage "${stage.name}" (${stage.strategy}) — ${stage.description}`);

        if (!stage.agents || stage.agents.length === 0) {
            log(`[Ruflo] Stage "${stage.name}" — pas d'agents, skip`);
            return {};
        }

        const agentFns = stage.agents.map(name => {
            const fn = this.agents.get(name);
            if (!fn) throw new Error(`Agent "${name}" non enregistre`);
            return { name, fn };
        });

        let stageResults = {};

        if (stage.strategy === 'parallel') {
            // Execute all agents in parallel with timeout
            const timeout = stage.timeout || 60000;
            const promises = agentFns.map(({ name, fn }) => {
                return Promise.race([
                    fn(context).then(result => {
                        log(`[Ruflo] Agent "${name}" termine (${((Date.now() - stageStart) / 1000).toFixed(1)}s)`);
                        return { name, result, status: 'fulfilled' };
                    }),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error(`Agent "${name}" timeout (${timeout / 1000}s)`)), timeout)
                    ),
                ]).catch(error => {
                    log(`[Ruflo] Agent "${name}" erreur: ${error.message}`);
                    return { name, result: null, status: 'rejected', error: error.message };
                });
            });

            const results = await Promise.allSettled(promises);
            for (const r of results) {
                const val = r.status === 'fulfilled' ? r.value : { name: 'unknown', result: null, status: 'rejected' };
                stageResults[val.name] = val.result;
                this.results.set(val.name, val.result);
            }
        } else {
            // Sequential execution
            for (const { name, fn } of agentFns) {
                try {
                    const result = await fn(context);
                    stageResults[name] = result;
                    this.results.set(name, result);
                    // Merge result into context for next agent
                    if (result && typeof result === 'object') {
                        Object.assign(context, result);
                    }
                    log(`[Ruflo] Agent "${name}" termine (${((Date.now() - stageStart) / 1000).toFixed(1)}s)`);
                } catch (error) {
                    log(`[Ruflo] Agent "${name}" erreur: ${error.message}`);
                    stageResults[name] = null;
                }
            }
        }

        const elapsed = ((Date.now() - stageStart) / 1000).toFixed(1);
        log(`[Ruflo] Stage "${stage.name}" terminee en ${elapsed}s`);
        return stageResults;
    }

    async run(context) {
        this.startTime = Date.now();
        log(`[Ruflo] Workflow "${this.workflow.name}" demarre — ${this.workflow.stages.length} stages`);

        for (const stage of this.workflow.stages) {
            // Check dependencies
            if (stage.depends_on) {
                for (const dep of stage.depends_on) {
                    if (!this.results.has('_stage_' + dep)) {
                        log(`[Ruflo] Stage "${stage.name}" attend "${dep}" — deja completee`);
                    }
                }
            }

            const stageResults = await this.executeStage(stage, context);
            this.results.set('_stage_' + stage.name, stageResults);

            // Merge stage results into context
            for (const [, result] of Object.entries(stageResults)) {
                if (result && typeof result === 'object') {
                    Object.assign(context, result);
                }
            }
        }

        const totalElapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        log(`[Ruflo] Workflow "${this.workflow.name}" termine en ${totalElapsed}s`);
        return context;
    }
}

module.exports = { RufloOrchestrator };
