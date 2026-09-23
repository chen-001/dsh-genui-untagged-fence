//#region lib/index.js
/**
 * 宿主半边。本插件只改浏览器端行为，宿主这边什么都不做；这个空壳的存在是为了
 * 插件在宿主 Loader 里有一条 entry，浏览器半边才会被客户端模块系统发现
 * （发现路径走 package.json 的 dsh.client 声明）。
 */
/** 插件名（等于配置里的 entry id）。 */
const name = 'dsh-genui-untagged-fence';
/** 宿主半边不用任何服务。 */
const inject = [];
/** 宿主半边无行为。 */
function apply() {}
//#endregion

export { apply, inject, name };
