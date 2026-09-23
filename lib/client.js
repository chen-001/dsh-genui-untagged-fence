window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-genui-untagged-fence",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		//#region src/client/index.js
		/**
		 * 浏览器半边：把「漏写 dsh-ui 标签的界面围栏」重新交回 dsh-genui 渲染。
		 *
		 * 背景：模型偶尔会把界面规格当普通代码块发出来（围栏后面没写 dsh-ui），
		 * dsh-genui 的 DOM 通道只按横幅上的语言串识别围栏，settled 阶段遇到没有
		 * 语言串的代码块会直接跳过，于是规格就以 JSON 原文的形式留在回复里。
		 *
		 * 做法：只观察 DOM，不改 dsh-genui 的代码。扫到满足条件的代码块时，往块里
		 * 塞一个隐藏的 dsh-ui 标签（就是 dsh-genui 认的那个语言串），它自己的
		 * DOM 通道随即按常规流程接管、解析、渲染。条件卡得很紧：
		 *   - 只在助手回复的行里（用户自己贴的 JSON 代码块不碰）；
		 *   - 块上当前没有任何语言串（写了 json / python 的块不碰）；
		 *   - 不在流式输出中（流式阶段 dsh-genui 已经按内容接管，不需要我们插手）；
		 *   - 正文是完整 JSON 对象，根上既有规格形状的键，也有真正放内容的键
		 *     （所以 {"type":"module"} 这类配置片段不会被误判成界面）。
		 * 卸载本插件（或它自己关掉）时移除补上的标签，恢复原样。
		 */
		/** 插件名（等于配置里的 entry id）。 */
		const name = "dsh-genui-untagged-fence";

		/** 纯 DOM 观察，不需要任何客户端服务。 */
		const inject = [];

		/** 宿主代码块的外层类名，与 dsh-genui 的 DOM 通道一致。 */
		const SURFACES = ".md-code-block, .code-block, .code-block-small";

		/** 流式渲染标记，落在 AssistantMarkdown 上。 */
		const STREAMING = "[data-streaming]";

		/** dsh-genui 接管后写在块上的标记。 */
		const RENDERED = "data-genui-rendered";

		/** 我们自己补的标签的标记。 */
		const RELABEL = "data-genui-relabel";

		/** dsh-genui 认的围栏语言串。 */
		const LANG = "dsh-ui";

		/** 会话行（flowItem）的身份属性，取行种类和行键。 */
		const ROW_SELECTOR = "[data-chat-anchor-key], [data-chat-flow-key], [data-chat-flow-kind]";

		/** 规格的形状，根对象里出现这些键之一才算。 */
		const SPEC_SHAPE = /"(items|type|title|panel)"\s*:/;

		/** 真正放内容的键。只有形状键、没有内容键的 JSON（例如 {"type":"module"}）不接管。 */
		const CONTENT_KEY = /"(?:items|content|code|pairs|rows|columns|steps|series|data|value|label|tabs)"\s*:/;

		/** 兜底扫描间隔，MutationObserver 漏掉的改动（虚拟列表回收重建等）靠它补上。 */
		const SWEEP_MS = 1000;

		/** 块里的代码正文。 */
		function bodyOf(block) {
			const pre = block.querySelector("pre");
			return pre === null ? "" : pre.textContent ?? "";
		}

		/** 宿主横幅上的语言串。返回 null 表示压根没有横幅，返回空串表示横幅没写语言。 */
		function labelOf(block) {
			const pre = block.querySelector("pre");
			for (const el of block.querySelectorAll("*")) {
				if (el.childElementCount !== 0) continue;
				if (pre !== null && pre.contains(el)) continue;
				return el.textContent ?? "";
			}
			return null;
		}

		/** 这个块该不该补标签。 */
		function needsRelabel(block) {
			if (block.hasAttribute(RENDERED)) return false;
			const label = labelOf(block);
			if (label !== null && label.trim() !== "") return false;
			if (block.closest(STREAMING) !== null) return false;
			const row = block.closest(ROW_SELECTOR);
			if (row === null) return false;
			if (row.hasAttribute("data-turn-process-hidden")) return false;
			const kind = row.getAttribute("data-chat-flow-kind") ?? "";
			const key = row.getAttribute("data-chat-anchor-key") ?? row.getAttribute("data-chat-flow-key") ?? "";
			if (kind !== "assistant-step" && !key.includes("assistant-step")) return false;
			const body = bodyOf(block).trim();
			if (!body.startsWith("{") || !SPEC_SHAPE.test(body) || !CONTENT_KEY.test(body)) return false;
			let parsed = null;
			try {
				parsed = JSON.parse(body);
			} catch (error) {
				return false;
			}
			return parsed !== null && typeof parsed === "object" && Array.isArray(parsed) === false;
		}

		/** 往块里补一个隐藏的 dsh-ui 标签。 */
		function relabel(block) {
			const tag = document.createElement("div");
			tag.setAttribute(RELABEL, "");
			tag.setAttribute("aria-hidden", "true");
			tag.style.display = "none";
			tag.textContent = LANG;
			block.appendChild(tag);
		}

		/** 已补标签的块数，写在根元素上，方便自查。 */
		let total = 0;

		/** 扫一遍当前页面里所有代码块。 */
		function sweep() {
			let count = 0;
			for (const block of document.querySelectorAll(SURFACES)) {
				if (!needsRelabel(block)) continue;
				relabel(block);
				count += 1;
			}
			if (count > 0) {
				total += count;
				document.documentElement.setAttribute("data-genui-relabel-count", String(total));
			}
		}

		/** cordis 客户端入口。 */
		function apply(ctx) {
			if (typeof document === "undefined") return () => {};
			document.documentElement.setAttribute("data-genui-untagged-fence", "active");
			let frame = null;
			const schedule = () => {
				if (frame !== null) return;
				frame = requestAnimationFrame(() => {
					frame = null;
					sweep();
				});
			};
			const observer = new MutationObserver(schedule);
			observer.observe(document.body, { childList: true, subtree: true, characterData: true });
			const timer = window.setInterval(sweep, SWEEP_MS);
			sweep();
			console.info("[dsh-genui-untagged-fence] 已启用，漏写 dsh-ui 标签的界面围栏会照常渲染");
			return () => {
				observer.disconnect();
				window.clearInterval(timer);
				if (frame !== null) cancelAnimationFrame(frame);
				for (const tag of document.querySelectorAll("[" + RELABEL + "]")) tag.remove();
				document.documentElement.removeAttribute("data-genui-untagged-fence");
				document.documentElement.removeAttribute("data-genui-relabel-count");
			};
		}
		//#endregion

		exports.name = name;
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
