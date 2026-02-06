package com.acme.persimmon.demo.tenantprovisioning.infra.repository.biz.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.biz.po.DemoBizPO;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface DemoBizMapper extends BaseMapper<DemoBizPO> {}
