//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.
//
//    Copyright (c) Zenasoft
//
var Etcd =require('node-etcd')
import {ContainerInfo} from './discover'
import {Options} from './options'
import * as os from 'os'
var Rx =require('rx')
import * as events from 'events';
import {ServiceDefinition, ServiceVersionDefinition, IReporter} from './reporter'

// vulcain/<cluster>/runtime/services/<host>/<name>/<version>/<id>
// vulcain/<cluster>/runtime/hosts/<host>
export class EtcdReporter implements IReporter
{
    private etcd;
    private runtimePrefix:string;
    private lastIndex:string;
    private Options:Options;
    
    constructor(private options:Options) 
    {
        this.options.ttl = options.ttl || 20;
        this.etcd = new Etcd(options.kv || "local-store", 2379);  
        this.runtimePrefix = `vulcain/${options.cluster}/runtime/services/${os.hostname()}`;  
        console.log("Starting consul reporter on " + (options.kv || "local-store"));
    }
           
    private panic(err) {
        let e = new events.EventEmitter();  
        e.emit("Error", err);
    }
    
    async startAsync() 
    {
        let self = this;
        
        setTimeout( this.renewAsync.bind(this), this.options.ttl*1000/2);
        
        let hostDefinition = 
        {
            name:os.hostname(), 
            ip:this.options.hostIp, 
            platform: os.type(), 
            cluster:this.options.cluster,
            memory: os.totalmem(),
            infos: [
                {"discovery" : this.options.version}
            ]
        }; 
                
        this.etcd.set(
            `vulcain/${this.options.cluster}/runtime/hosts/${os.hostname()}`, 
            JSON.stringify(hostDefinition),
            {},
            (err) => { 
                console.log(">> Host registered with %j %s", hostDefinition, err||"");
                self.panic(err);
            }
        );
        
        this.etcd.set(
            this.runtimePrefix, 
            "",
            {},
            (err) => { 
                self.panic(err);
            }
        );    
    }
    
    private async renewAsync() 
    {
        let self = this;
        try 
        {
            await self.renewSessionAsync();
            setTimeout( self.renewAsync.bind(self), self.options.ttl * 1000 / 2);
        }
        catch(e) {
            self.panic(e);
        }
    }
    
    renewSessionAsync() 
    {
        return new Promise((resolve, reject) => 
        {
           if(this.options.debug)
                console.log(">> Renew session at " + Date.now().toLocaleString());
                
            this.etcd.mkdir(this.runtimePrefix, {ttl:this.options.ttl, prevExist:true}, (err)=>
            {
                if(err) 
                    reject(err);
                else
                    resolve();
            });
            
            this.etcd.mkdir(
                `vulcain/${this.options.cluster}/runtime/hosts/${os.hostname()}`, 
                {ttl:this.options.ttl, prevExist:true}, 
                (err)=>
                {
                    if(err) 
                        reject(err);
                    else
                        resolve();
                }
            );
        });        
    }
    
    registerServiceAsync(service:ContainerInfo) 
    {
        return new Promise((resolve, reject) => {
            this.etcd.set(
                `${this.runtimePrefix}/${service.name}/${service.version}/${service.id}`, 
                JSON.stringify(service),
                {},
                (err,data) => {
                if(err) 
                    reject(err);
                else
                    resolve(data);
            });
        });
    }
    
    getServiceDefinitionAsync(name:string) : Promise<ServiceDefinition> {
        return new Promise((resolve, reject) => {
            this.etcd.get(
                `vulcain/${this.options.cluster}/definitions/services/${name}`,
                null,
                (err,data) => {
                if(err) 
                    reject(err);
                 else {
                    resolve(data && JSON.parse(data.node.value));
                 }
            });
        });
    }
    
    getServiceVersionDefinitionAsync(name:string, version:string) : Promise<ServiceVersionDefinition> {
        return new Promise((resolve, reject) => {
            this.etcd.get(
                `vulcain/${this.options.cluster}/definitions/services/${name}/${version}`,
                null,
                (err,data) => {
                if(err) 
                    reject(err);
                 else {
                    resolve(data && JSON.parse(data.node.value));
                 }
            });
        });
    }
        
    removeServicesAsync() {
        return new Promise((resolve, reject) => {
            let key = this.runtimePrefix;
            this.etcd.del(key, {recurse:true},
            (err) => {
                resolve();
            });
        });        
    }
    
    removeServiceAsync(service:ContainerInfo) {
        return new Promise((resolve, reject) => {
            let key = `${this.runtimePrefix}/${service.name}/${service.version}/${service.id}`;
            this.etcd.del(key, {recurse:true},
            (err) => {
                if(err) 
                    reject(err);
                else
                    resolve();
            });
        });        
    }
    
    watchDefinitionsChanges(queue) 
    {
        let self = this;
        let watch = this.etcd.watcher(`vulcain/${this.options.cluster}/definitions/services/refresh`, null, {recursive:false});

        watch.on('change', function(data) {
            if(data) 
            {
                queue.onNext(data);
            }
        });

        watch.on('error', function(err) {
            self.panic(err);
        });
    }
    
    watchRuntimeChanges(queue) 
    {
        let self = this;
        let watch = this.etcd.watcher(`vulcain/${this.options.cluster}/runtime/services`, null, {recursive:true});

        watch.on('change', function(data) {
            if(data) 
            {
                queue.onNext(data);
            }
        });

        watch.on('error', function(err) {
            self.panic(err);
        });
    }
}