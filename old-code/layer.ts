import { Feature, IPixelPos } from "./Interface";
import { transformer } from "./Transformer";
import { Utils } from "./utils";
class Layer {

    static layers: Layer[] = [];  // 所有的图层集合

    features: Feature[] = []  // 图层中的元素集合
    name: string = ''
    actived = true; // 是否生效,ture才渲染到画布上
    domElement = document.createElement("canvas");
    ctx = this.domElement.getContext("2d")!;  // scene设置宽高同时也会设置layer的宽高

    id = Utils.getUuid()
    zIndex = 0;

    constructor() {
        this.zIndex = Layer.layers.length + 1;
        this.name = `layer${this.zIndex}`
        Layer.layers.push(this);
    }
    // 递归获取所有元素,包含元素的子元素
    getFeatures(features = this.features, result: Feature[] = []) {  // 获取该图层下所有元素
        result.push(...features);
        features.forEach(f => {
            this.getFeatures(f.children, result)
        })
        return result;
    }

    render(focusNode?: Feature | null, mousePos?: IPixelPos, all = false) {
        if (!this.actived) return;
        if (focusNode && !all) {
            const flatFeatures = this.getFeatures();
            if (flatFeatures.includes(focusNode) || flatFeatures.find(f => f.bounded)) {  // bbox和bbox绑定的图层也要刷新,因为只拖拽控制点,也要更改控制点的目标元素
                console.log("当前图层更新", this.features);
                this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
                this.features.forEach(f => {
                    if (f.parent) return;
                    f.draw(this.ctx, f.getTransformer(transformer), mousePos);
                })
            } else {
                // console.log("静态图层");
                this.features.forEach(f => {  // 这里的draw方法只是用来判断鼠标的是否悬浮上去
                    if (f.parent) return;
                    f.draw(this.ctx, f.getTransformer(transformer), mousePos, false);
                })
            }
        } else {
            console.log("全部图层更新");
            this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height)
            this.features.forEach(f => {
                if (f.parent) return;
                f.draw(this.ctx, f.getTransformer(transformer), mousePos);
            })
        }
        return this.ctx;
    }

    getHoverNodes(mousePos: IPixelPos, features: Feature[] = this.features, hoverNodes: Feature[] = []): Feature[] {
        for (let index = features.length - 1; index >= 0; index--) {
            const feature = features[index];
            // 先递归检查子元素
            if (feature.children.length && feature.cbSelectChild) {
                this.getHoverNodes(mousePos, feature.children, hoverNodes);
            }
            // 检查当前元素
            const paint = feature.draw(this.ctx, feature.getTransformer(transformer), mousePos);
            if (paint && feature.isPointIn) {
                hoverNodes.push(feature);
                break; // 如果找到当前元素，停止继续向上冒泡
            }
        }
        return hoverNodes;
    }

    add(feature: Feature) {
        if (this.features.includes(feature)) return;
        this.features.push(feature)
        return this;
    }

    remove(feature: Feature) {
        const index = this.features.findIndex(f => f == feature)
        this.features.splice(index, 1)
        // this.features = this.features.filter(f => f.id != feature.id);
        return this;
    }

    resortIndex() {
        this.features.sort((a, b) => a.zIndex - b.zIndex);
        this.render();
        return this;
    }

}

const layer = new Layer();  // 默认图层
const bLayer = new Layer();  // 包围盒图层
bLayer.zIndex = Infinity;
bLayer.name = "bbox";
bLayer.actived = false;

export {
    layer,
    bLayer,
    Layer
}