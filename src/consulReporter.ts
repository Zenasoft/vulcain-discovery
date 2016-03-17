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
var Consul = require('consul');
import {ContainerInfo} from './discover'
import {Options} from './options'
import * as os from 'os'
var Rx =require('rx')
import * as events from 'events';
import {ServiceDefinition, ServiceVersionDefinition, IReporter} from './reporter'

// vulcain/<cluster>/runtime/services/<host>/<name>/<version>/<id>
// vulcain/<cluster>/runtime/hosts/<host>
export class ConsulReporter implements IReporter
{
    private consul;
    private runtimePrefix:string;
    private sessionId:string;
    private lastIndex:string;
    private Options:Options;
    
    constructor(private options:Options) 
    {
        this.options.ttl = options.ttl || 20;
        this.consul = Consul({host:options.kv || "local-store"});  
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
        await this.createSessionAsync();
        console.log("Consul session initialized with id=" + this.sessionId);
        
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
                
        this.consul.kv.set(
            `vulcain/${this.options.cluster}/runtime/hosts/${os.hostname()}`, 
            JSON.stringify(hostDefinition),
            { acquire: this.sessionId },
            (err) => { 
                console.log(">> Host registered with %j %s, %s", hostDefinition, this.sessionId, err||"");
                self.panic(err);
            }
        );
        
        this.consul.kv.set(
            this.runtimePrefix, 
            "",
            { acquire: this.sessionId },
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
    
    createSessionAsync() 
    {
        let self = this;
        return new Promise((resolve, reject) => 
        {
            console.log("Creating a session with ttl=" + this.options.ttl);
                
            this.consul.session.create({ttl:`${this.options.ttl}s`, behavior:"delete"}, (err,data)=>
            {
                if(err)
                    self.panic(err);
                else {
                    this.sessionId = data.ID;
                    resolve(data.ID);
                }
            });    
        });
    }
    
    renewSessionAsync() 
    {
        return new Promise((resolve, reject) => 
        {
           if(this.options.debug)
                console.log(">> Renew session " + this.sessionId + " at " + Date.now().toLocaleString());
                
            this.consul.session.renew(this.sessionId, (err,data) => {
                if(err) 
                    reject(err);
                else
                    resolve(data);
            });
        });        
    }
    
    registerServiceAsync(service:ContainerInfo) {
        return new Promise((resolve, reject) => {
            this.consul.kv.set(
                `${this.runtimePrefix}/${service.name}/${service.version}/${service.id}`, 
                JSON.stringify(service),
                {acquire: this.sessionId},
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
            this.consul.kv.get(
                `vulcain/${this.options.cluster}/definitions/services/${name}`,
                (err,data) => {
                if(err) 
                    reject(err);
                 else {
                    resolve(data && JSON.parse(data.Value));
                 }
            });
        });
    }
    
    getServiceVersionDefinitionAsync(name:string, version:string) : Promise<ServiceVersionDefinition> {
        return new Promise((resolve, reject) => {
            this.consul.kv.get(
                `vulcain/${this.options.cluster}/definitions/services/${name}/${version}`,
                (err,data) => {
                if(err) 
                    reject(err);
                 else {
                    resolve(data && JSON.parse(data.Value));
                 }
            });
        });
    }
    
    removeServicesAsync() {
        return new Promise((resolve, reject) => {
            let key = this.runtimePrefix;
            this.consul.kv.del({key:key, recurse:true},
            (err,data) => {
                resolve(data);
            });
        });        
    }
    
    removeServiceAsync(service:ContainerInfo) {
        return new Promise((resolve, reject) => {
            let key = `${this.runtimePrefix}/${service.name}/${service.version}/${service.id}`;
            this.consul.kv.del({key:key, recurse:true},
            (err,data) => {
                if(err) 
                    reject(err);
                else
                    resolve(data);
            });
        });        
    }
    
    watchDefinitionsChanges(queue) 
    {
        let self = this;
        let watch = this.consul.watch({ method: this.consul.kv.get, options: { key: `vulcain/${this.options.cluster}/definitions/services/refresh` }});

        watch.on('change', function(data, res) {
            if(data) 
            {
                queue.onNext(data);
            }
        });

        watch.on('error', function(err) {
            watch.end();
            self.panic(err);
        });
    }
    
    watchRuntimeChanges(queue) 
    {
        let self = this;
        let watch = this.consul.watch({ method: this.consul.kv.get, options: { recurse:true, key: `vulcain/${this.options.cluster}/runtime/services` }});

        watch.on('change', function(data, res) {
            if(data) 
            {
                queue.onNext(data);
            }
        });

        watch.on('error', function(err) {
            watch.end();
            self.panic(err);
        });
    }
}