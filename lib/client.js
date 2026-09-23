window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-genui-untagged-fence",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		//#region src/client/index.js
		/**
		 * 浏览器半边：把模型漏掉围栏标记的界面规格，重新交回 dsh-genui 渲染。
		 *
		 * 修的是同一类毛病的两种样子。
		 * 一、规格写进了代码块，但围栏后面没写 dsh-ui。dsh-genui 的 DOM 通道按横幅
		 *     上的语言串认围栏，settled 阶段遇到没有语言串的代码块直接跳过。
		 * 二、规格压根没写进代码块，整段就是纯文本。dsh-genui 只处理代码块，文本
		 *     段落它看不见。
		 *
		 * 做法都是借 dsh-genui 自己的通道干活，不改 dsh-genui，也不改 DSH 内核。
		 * 第一种情况往块里补一个隐藏的 dsh-ui 标签；第二种情况先照着原文造一个合成
		 * 代码块（同样带隐藏标签），让 dsh-genui 接管它，再把原段落藏起来。
		 *
		 * 判定卡得紧，避免误伤：只在 assistant-step 行里；不在流式输出中；正文是完整
		 * JSON 对象，根上既有规格形状的键也有真正放内容的键（{"type":"module"} 这类
		 * 配置片段不接管）；写了别的语言串的代码块、用户自己贴的内容一律不碰。
		 * 卸载本插件时补上的标签和合成块全部撤掉，隐藏的段落还原。
		 */
		/** 插件名（等于配置里的 entry id）。 */
		const name = "dsh-genui-untagged-fence";

		/** 纯 DOM 观察，不需要任何客户端服务。 */
		const inject = [];

		/** 宿主代码块的外层类名，与 dsh-genui 的 DOM 通道一致。 */
		const SURFACES = ".md-code-block, .code-block, .code-block-small";

		/** 助手回复的行。 */
		const ASSISTANT_ROWS = '[data-chat-flow-kind="assistant-step"]';

		/** 会话行身份属性，取行键用。 */
		const ROW_SELECTOR = "[data-chat-anchor-key], [data-chat-flow-key], [data-chat-flow-kind]";

		/** 流式渲染标记，落在 AssistantMarkdown 上。 */
		const STREAMING = "[data-streaming]";

		/** dsh-genui 接管后写在块上的标记。 */
		const RENDERED = "data-genui-rendered";

		/** 我们补的标签的标记。 */
		const RELABEL = "data-genui-relabel";

		/** 我们造的合成代码块的标记。 */
		const SYNTHETIC = "data-genui-spec-block";

		/** 已经处理过的纯文本段落的标记。 */
		const SPEC_SOURCE = "data-genui-spec-source";

		/** dsh-genui 认的围栏语言串。 */
		const LANG = "dsh-ui";

		/** 规格的形状，根对象里出现这些键之一才算。 */
		const SPEC_SHAPE = /"(items|type|title|panel)"\s*:/;

		/** 真正放内容的键。只有形状键、没有内容键的 JSON（例如 {"type":"module"}）不接管。 */
		const CONTENT_KEY = /"(?:items|content|code|pairs|rows|columns|steps|series|data|value|label|tabs)"\s*:/;

		/** 纯文本段落的最小长度，短于它的不可能是规格。 */
		const MIN_TEXT = 16;

		/** 兜底扫描间隔，MutationObserver 漏掉的改动（虚拟列表回收重建等）靠它补上。 */
		const SWEEP_MS = 1000;

		/** 已处理的处数，写在根元素上，方便自查。 */
		let handled = 0;

		/** 块里的代码正文。 */
		function bodyOf(block) {
			const pre = block.querySelector("pre");
			return pre === null ? "" : pre.textContent ?? "";
		}

		/** 元素里的文字。换行元素算换行符，JSON 里换行是有意义的。 */
		function textOf(el) {
			let out = "";
			for (const node of el.childNodes) {
				if (node.nodeType === 1 && node.tagName === "BR") {
					out += "\n";
					continue;
				}
				if (node.nodeType === 1) {
					out += textOf(node);
					continue;
				}
				out += node.textContent ?? "";
			}
			return out;
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

		/** 正文是不是一段完整的界面规格。 */
		function isSpec(text) {
			const body = text.trim();
			if (body.length < MIN_TEXT || body.startsWith("{") === false) return false;
			if (!SPEC_SHAPE.test(body) || !CONTENT_KEY.test(body)) return false;
			let parsed = null;
			try {
				parsed = JSON.parse(body);
			} catch (error) {
				return false;
			}
			return parsed !== null && typeof parsed === "object" && Array.isArray(parsed) === false;
		}

		/** 这个行是不是助手回复的内容行。 */
		function isAssistantRow(row) {
			if (row === null || row.hasAttribute("data-turn-process-hidden")) return false;
			if (row.closest(STREAMING) !== null) return false;
			const kind = row.getAttribute("data-chat-flow-kind") ?? "";
			if (kind === "assistant-step") return true;
			const key = row.getAttribute("data-chat-anchor-key") ?? row.getAttribute("data-chat-flow-key") ?? "";
			return key.includes("assistant-step");
		}

		/** 造一个隐藏标签，内容就是 dsh-genui 认的语言串。 */
		function makeLabel() {
			const tag = document.createElement("div");
			tag.setAttribute(RELABEL, "");
			tag.setAttribute("aria-hidden", "true");
			tag.style.display = "none";
			tag.textContent = LANG;
			return tag;
		}

		/** 照着规格原文造一个合成代码块，等 dsh-genui 来接管。 */
		function makeSyntheticBlock(text) {
			const block = document.createElement("div");
			block.className = "md-code-block";
			block.setAttribute(SYNTHETIC, "");
			block.appendChild(makeLabel());
			const pre = document.createElement("pre");
			pre.textContent = text;
			block.appendChild(pre);
			return block;
		}

		/** 第一种样子，代码块没写语言串，补个隐藏标签，dsh-genui 就会认它。 */
		function scanUntaggedBlocks() {
			let count = 0;
			for (const block of document.querySelectorAll(SURFACES)) {
				if (block.hasAttribute(RENDERED) || block.hasAttribute(SYNTHETIC)) continue;
				const label = labelOf(block);
				if (label !== null && label.trim() !== "") continue;
				if (!isAssistantRow(block.closest(ROW_SELECTOR))) continue;
				if (!isSpec(bodyOf(block))) continue;
				block.appendChild(makeLabel());
				count += 1;
			}
			return count;
		}

		/**
		 * 第二种样子，规格是纯文本段落。造合成代码块交出去，再把原段落藏起来。
		 * 先造块后藏段落，所以任何时刻屏幕上都有一份内容，不会出现空白。
		 */
		function scanTextSpecs() {
			let count = 0;
			for (const row of document.querySelectorAll(ASSISTANT_ROWS)) {
				if (!isAssistantRow(row)) continue;
				for (const para of row.querySelectorAll("p")) {
					if (para.hasAttribute(SPEC_SOURCE)) continue;
					if (para.closest("pre") !== null) continue;
					// 先用原生的 textContent 粗筛，只有像规格的段落才做逐节点扫描。
					const raw = para.textContent ?? "";
					if (raw.trim().startsWith("{") === false) continue;
					const text = textOf(para);
					if (!isSpec(text)) continue;
					const previous = para.previousElementSibling;
					if (previous === null || previous.hasAttribute(SYNTHETIC) === false) {
						para.parentElement.insertBefore(makeSyntheticBlock(text.trim()), para);
					}
					para.setAttribute(SPEC_SOURCE, "");
					para.style.display = "none";
					count += 1;
				}
			}
			return count;
		}

		/** 扫一遍当前页面。 */
		function sweep() {
			const count = scanUntaggedBlocks() + scanTextSpecs();
			if (count === 0) return;
			handled += count;
			document.documentElement.setAttribute("data-genui-relabel-count", String(handled));
		}

		/** 把本插件加进去的东西全部撤掉。 */
		function restore() {
			for (const tag of document.querySelectorAll("[" + RELABEL + "]")) tag.remove();
			for (const block of document.querySelectorAll("[" + SYNTHETIC + "]")) block.remove();
			for (const para of document.querySelectorAll("[" + SPEC_SOURCE + "]")) {
				para.removeAttribute(SPEC_SOURCE);
				para.style.display = "";
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
			console.info("[dsh-genui-untagged-fence] 已启用，漏写围栏标记的界面规格会照常渲染");
			return () => {
				observer.disconnect();
				window.clearInterval(timer);
				if (frame !== null) cancelAnimationFrame(frame);
				restore();
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
